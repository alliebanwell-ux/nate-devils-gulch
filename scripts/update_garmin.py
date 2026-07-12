#!/usr/bin/env python3
"""Update race.json and course.json from a Garmin MapShare Raw KML feed."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
PACIFIC = ZoneInfo("America/Los_Angeles")


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def first_number(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    return float(match.group(0)) if match else None


def parse_garmin_kml(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    if not raw.strip():
        raise RuntimeError("Garmin returned an empty KML file.")

    root = ET.fromstring(raw)
    candidates: list[dict] = []

    for placemark in root.findall(".//k:Placemark", KML_NS):
        values: dict[str, str] = {}
        for item in placemark.findall("./k:ExtendedData/k:Data", KML_NS):
            name = item.attrib.get("name", "")
            values[name] = item.findtext("k:value", default="", namespaces=KML_NS)

        if not values or not values.get("Time UTC"):
            continue
        if values.get("Valid GPS Fix", "True").lower() != "true":
            continue

        lat = first_number(values.get("Latitude"))
        lon = first_number(values.get("Longitude"))
        if lat is None or lon is None:
            coordinate_text = placemark.findtext(
                ".//k:Point/k:coordinates", default="", namespaces=KML_NS
            )
            parts = [part.strip() for part in coordinate_text.split(",")]
            if len(parts) >= 2:
                lon, lat = float(parts[0]), float(parts[1])

        if lat is None or lon is None:
            continue

        timestamp = datetime.strptime(
            values["Time UTC"], "%m/%d/%Y %I:%M:%S %p"
        ).replace(tzinfo=ZoneInfo("UTC"))

        elevation_m = first_number(values.get("Elevation"))
        velocity_kph = first_number(values.get("Velocity"))

        candidates.append(
            {
                "timestamp": timestamp,
                "lat": lat,
                "lon": lon,
                "elevationFt": elevation_m * 3.28084 if elevation_m is not None else None,
                "deviceSpeedMph": velocity_kph * 0.621371 if velocity_kph is not None else None,
            }
        )

    if not candidates:
        raise RuntimeError("No valid Garmin tracking point was found in the KML.")

    return max(candidates, key=lambda point: point["timestamp"])


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def snap_to_route(point: dict, route: list[dict], previous_mile: float) -> dict:
    # This course crosses itself repeatedly. Prefer plausible forward progress and
    # reject route points far behind or implausibly far ahead of the prior ping.
    candidates = [
        route_point
        for route_point in route
        if previous_mile - 0.35 <= route_point["mile"] <= previous_mile + 8.0
    ]
    if not candidates:
        candidates = route

    best = min(
        candidates,
        key=lambda route_point: haversine_m(
            point["lat"], point["lon"], route_point["lat"], route_point["lon"]
        ),
    )
    return {
        **best,
        "snapMeters": haversine_m(
            point["lat"], point["lon"], best["lat"], best["lon"]
        ),
    }


def interpolate_course_mile(gpx_mile: float, stations: list[dict]) -> float:
    ordered = sorted(stations, key=lambda station: station["gpxMile"])
    prior = {"gpxMile": 0.0, "courseMile": 0.0}
    following = ordered[-1]

    for station in ordered:
        if station["gpxMile"] <= gpx_mile:
            prior = station
        if station["gpxMile"] >= gpx_mile:
            following = station
            break

    span = following["gpxMile"] - prior["gpxMile"]
    if span <= 0:
        return float(prior["courseMile"])

    ratio = (gpx_mile - prior["gpxMile"]) / span
    return prior["courseMile"] + ratio * (
        following["courseMile"] - prior["courseMile"]
    )


def update_station_statuses(stations: list[dict], current_gpx_mile: float) -> None:
    future_found = False
    for station in sorted(stations, key=lambda item: item["gpxMile"]):
        if station["name"] == "Finish":
            station["status"] = "finish"
        elif station["gpxMile"] <= current_gpx_mile + 0.15:
            station["status"] = "passed"
        elif not future_found:
            station["status"] = "next"
            future_found = True
        else:
            station["status"] = "upcoming"


def current_section(stations: list[dict], current_gpx_mile: float) -> tuple[str, str]:
    ordered = sorted(stations, key=lambda station: station["gpxMile"])
    previous = None
    next_station = None

    for station in ordered:
        if station["gpxMile"] <= current_gpx_mile + 0.15:
            previous = station
        elif next_station is None:
            next_station = station
            break

    if previous and next_station:
        return (
            f'{previous["name"]} → {next_station["name"]}',
            f'Past {previous["name"]}; moving toward {next_station["name"]}',
        )
    if next_station:
        return (f'Start → {next_station["name"]}', f'Moving toward {next_station["name"]}')
    return ("Final approach", "Moving toward the finish")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kml", default="feed.kml")
    parser.add_argument("--race", default="race.json")
    parser.add_argument("--course", default="course.json")
    args = parser.parse_args()

    kml_path = Path(args.kml)
    race_path = Path(args.race)
    course_path = Path(args.course)

    race = load_json(race_path)
    course = load_json(course_path)
    point = parse_garmin_kml(kml_path)

    new_time = point["timestamp"].astimezone(PACIFIC)
    old_time = datetime.fromisoformat(race["latest"]["time"])

    if new_time <= old_time:
        print(f"No update: Garmin point {new_time.isoformat()} is not newer.")
        return 0

    previous_mile = float(race["latest"]["gpxMile"])
    snapped = snap_to_route(point, course["route"], previous_mile)

    # Prevent an obviously bad route match from publishing.
    if snapped["snapMeters"] > 300:
        raise RuntimeError(
            f'Closest plausible course point is {snapped["snapMeters"]:.0f} m away; '
            "refusing to update automatically."
        )
    if snapped["mile"] < previous_mile - 0.35:
        raise RuntimeError("New route match moves too far backward; refusing update.")

    elapsed_hours = (new_time - old_time).total_seconds() / 3600
    segment_mph = (
        (snapped["mile"] - previous_mile) / elapsed_hours
        if elapsed_hours > 0
        else None
    )

    update_station_statuses(course["stations"], snapped["mile"])
    section, note = current_section(course["stations"], snapped["mile"])
    display_mile = interpolate_course_mile(snapped["mile"], course["stations"])

    checkin = {
        "time": new_time.isoformat(),
        "lat": point["lat"],
        "lon": point["lon"],
        "gpxMile": snapped["mile"],
        "snapMeters": snapped["snapMeters"],
        "segmentMph": segment_mph,
    }
    if point["deviceSpeedMph"] is not None:
        checkin["deviceSpeedMph"] = point["deviceSpeedMph"]
    if point["elevationFt"] is not None:
        checkin["elevationFt"] = point["elevationFt"]

    existing = race.setdefault("checkins", [])
    if not any(item.get("time") == checkin["time"] for item in existing):
        existing.append(checkin)
        existing.sort(key=lambda item: item["time"])

    race["latest"] = {
        "time": new_time.isoformat(),
        "lat": point["lat"],
        "lon": point["lon"],
        "gpxMile": snapped["mile"],
        "courseMileLabel": f"{display_mile:.1f}",
        "section": section,
        "note": note,
    }
    race["lastUpdatedLabel"] = new_time.strftime("%A %-I:%M %p")

    save_json(race_path, race)
    save_json(course_path, course)

    print(
        f'Updated to {new_time.isoformat()} | GPX mile {snapped["mile"]:.2f} | '
        f'course mile {display_mile:.1f} | snap {snapped["snapMeters"]:.1f} m'
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
