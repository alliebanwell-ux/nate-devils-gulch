#!/usr/bin/env python3
"""Update race.json and course.json from a Garmin MapShare Raw KML feed.

This version also recalculates all future ETA windows after every new Garmin point.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
PACIFIC = ZoneInfo("America/Los_Angeles")
UTC = ZoneInfo("UTC")


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
        ).replace(tzinfo=UTC)

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


def snap_to_route(point: dict, route: list[dict], previous_mile: float, elapsed_hours: float) -> dict:
    # Limit forward progress using elapsed time. Even 8 mph is generous for this course.
    plausible_forward = max(1.5, min(8.0, elapsed_hours * 8.0 + 0.75))
    candidates = [
        route_point
        for route_point in route
        if previous_mile - 0.35 <= route_point["mile"] <= previous_mile + plausible_forward
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


def ensure_plan_fields(stations: list[dict]) -> None:
    """Preserve the original planned ETA windows as immutable calibration data."""
    for station in stations:
        station.setdefault("planEtaLo", station["etaLo"])
        station.setdefault("planEtaHi", station["etaHi"])


def weighted_recent_speed(checkins: list[dict], now: datetime, current_mile: float) -> float | None:
    """Estimate recent moving speed from route progress, favoring the last 2–3 hours."""
    valid = []
    for item in checkins:
        try:
            t = datetime.fromisoformat(item["time"])
            mile = float(item["gpxMile"])
        except (KeyError, TypeError, ValueError):
            continue
        age_hours = (now - t).total_seconds() / 3600
        if 0 <= age_hours <= 4.0 and mile <= current_mile + 0.2:
            valid.append((t, mile))

    valid.sort()
    if len(valid) < 2:
        return None

    samples = []
    for i in range(1, len(valid)):
        t0, m0 = valid[i - 1]
        t1, m1 = valid[i]
        hours = (t1 - t0).total_seconds() / 3600
        miles = m1 - m0
        if hours <= 0 or miles < -0.2:
            continue
        speed = max(0.4, min(7.0, miles / hours))
        recency_weight = 1.0 + i / len(valid)
        duration_weight = min(1.5, max(0.25, hours))
        samples.append((speed, recency_weight * duration_weight))

    if not samples:
        return None

    return sum(speed * weight for speed, weight in samples) / sum(weight for _, weight in samples)


def planned_speed_for_current_leg(stations: list[dict], current_mile: float) -> float | None:
    ordered = sorted(stations, key=lambda station: station["gpxMile"])
    previous = {"gpxMile": 0.0, "planEtaLo": None, "planEtaHi": None}
    next_station = None

    for station in ordered:
        if station["gpxMile"] <= current_mile:
            previous = station
        else:
            next_station = station
            break

    if next_station is None:
        return None

    if previous["planEtaLo"] is None:
        # Use race start for the first leg.
        return None

    prev_mid = (
        datetime.fromisoformat(previous["planEtaLo"])
        + (datetime.fromisoformat(previous["planEtaHi"]) - datetime.fromisoformat(previous["planEtaLo"])) / 2
    )
    next_mid = (
        datetime.fromisoformat(next_station["planEtaLo"])
        + (datetime.fromisoformat(next_station["planEtaHi"]) - datetime.fromisoformat(next_station["planEtaLo"])) / 2
    )
    hours = (next_mid - prev_mid).total_seconds() / 3600
    distance = next_station["gpxMile"] - previous["gpxMile"]

    if hours <= 0 or distance <= 0:
        return None
    return distance / hours


def recalculate_etas(course: dict, race: dict, current_time: datetime, current_mile: float) -> None:
    stations = sorted(course["stations"], key=lambda station: station["gpxMile"])
    ensure_plan_fields(stations)

    observed_speed = weighted_recent_speed(
        race.get("checkins", []), current_time, current_mile
    )
    planned_speed = planned_speed_for_current_leg(stations, current_mile)

    if observed_speed and planned_speed:
        pace_factor = planned_speed / observed_speed
    else:
        pace_factor = 1.0

    # Keep one noisy Garmin interval from making the forecast absurd.
    pace_factor = max(0.72, min(1.65, pace_factor))

    previous_plan_mile = 0.0
    previous_plan_lo = datetime.fromisoformat(race["start"])
    previous_plan_hi = previous_plan_lo
    cumulative_lo = 0.0
    cumulative_hi = 0.0

    for station in stations:
        plan_lo = datetime.fromisoformat(station["planEtaLo"])
        plan_hi = datetime.fromisoformat(station["planEtaHi"])

        if station["gpxMile"] <= current_mile + 0.15:
            # Passed stations retain their recorded/planned display values.
            previous_plan_mile = station["gpxMile"]
            previous_plan_lo = plan_lo
            previous_plan_hi = plan_hi
            continue

        leg_distance = station["gpxMile"] - previous_plan_mile
        remaining_leg_distance = station["gpxMile"] - max(current_mile, previous_plan_mile)
        fraction = 1.0 if leg_distance <= 0 else max(0.0, min(1.0, remaining_leg_distance / leg_distance))

        base_leg_lo = max(1.0, (plan_lo - previous_plan_lo).total_seconds() / 60)
        base_leg_hi = max(base_leg_lo, (plan_hi - previous_plan_hi).total_seconds() / 60)

        leg_lo = base_leg_lo * fraction * pace_factor
        leg_hi = base_leg_hi * fraction * pace_factor

        # Add modest uncertainty as the forecast gets farther into the future.
        cumulative_distance = station["gpxMile"] - current_mile
        uncertainty = min(75.0, max(5.0, cumulative_distance * 0.7))
        leg_lo = max(1.0, leg_lo - uncertainty * 0.20)
        leg_hi = max(leg_lo + 5.0, leg_hi + uncertainty * 0.45)

        cumulative_lo += leg_lo
        cumulative_hi += leg_hi

        station["etaLo"] = (current_time + timedelta(minutes=cumulative_lo)).isoformat()
        station["etaHi"] = (current_time + timedelta(minutes=cumulative_hi)).isoformat()

        previous_plan_mile = station["gpxMile"]
        previous_plan_lo = plan_lo
        previous_plan_hi = plan_hi

    race["forecast"] = {
        "updatedAt": current_time.isoformat(),
        "observedRecentMph": round(observed_speed, 2) if observed_speed else None,
        "paceFactor": round(pace_factor, 3),
        "method": "terrain-adjusted planned segments calibrated to recent route speed",
    }


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
    elapsed_hours = max(0.01, (new_time - old_time).total_seconds() / 3600)
    snapped = snap_to_route(point, course["route"], previous_mile, elapsed_hours)

    if snapped["snapMeters"] > 300:
        raise RuntimeError(
            f'Closest plausible course point is {snapped["snapMeters"]:.0f} m away; '
            "refusing to update automatically."
        )
    if snapped["mile"] < previous_mile - 0.35:
        raise RuntimeError("New route match moves too far backward; refusing update.")

    segment_mph = (snapped["mile"] - previous_mile) / elapsed_hours

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
        "courseMile": round(display_mile, 3),
        "courseMileLabel": f"{display_mile:.1f}",
        "section": section,
        "note": note,
    }
    race["lastUpdatedLabel"] = new_time.strftime("%A %-I:%M %p")

    recalculate_etas(course, race, new_time, snapped["mile"])

    save_json(race_path, race)
    save_json(course_path, course)

    print(
        f'Updated to {new_time.isoformat()} | GPX mile {snapped["mile"]:.2f} | '
        f'course mile {display_mile:.1f} | snap {snapped["snapMeters"]:.1f} m'
    )
    forecast = race.get("forecast", {})
    print(
        f'Forecast calibration: recent speed={forecast.get("observedRecentMph")} mph, '
        f'pace factor={forecast.get("paceFactor")}'
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
