"use strict";

const DATA_REFRESH_MS = 60 * 1000;

async function loadJSON(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(date) {
  const day = date.toLocaleDateString([], { weekday: "short" });
  return `${formatTime(date)} ${day}`;
}

function formatWindow(low, high) {
  const sameDay = low.toDateString() === high.toDateString();
  return sameDay
    ? `${formatTime(low)}–${formatTime(high)}`
    : `${formatDateTime(low)}–${formatDateTime(high)}`;
}

function bufferText(minutes) {
  const rounded = Math.round(minutes);
  if (rounded < 0) return `${Math.abs(rounded)}m past`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function deriveStatuses(stations, currentGpxMile) {
  let nextAssigned = false;
  return stations
    .slice()
    .sort((a, b) => a.gpxMile - b.gpxMile)
    .map((station) => {
      let status;
      if (station.gpxMile <= currentGpxMile + 0.15) {
        status = "passed";
      } else if (!nextAssigned) {
        status = "next";
        nextAssigned = true;
      } else if (station.name === "Finish") {
        status = "finish";
      } else {
        status = "upcoming";
      }
      return { ...station, status };
    });
}

function deriveSection(stations, currentGpxMile) {
  let previous = null;
  let next = null;

  for (const station of stations) {
    if (station.gpxMile <= currentGpxMile + 0.15) previous = station;
    else {
      next = station;
      break;
    }
  }

  if (previous && next) {
    return {
      section: `${previous.name} → ${next.name}`,
      note: `Past ${previous.name}; moving toward ${next.name}`,
    };
  }
  if (next) {
    return {
      section: `Start → ${next.name}`,
      note: `Moving toward ${next.name}`,
    };
  }
  return {
    section: "Final approach",
    note: "Moving toward the finish",
  };
}

function getCourseMile(race, stations) {
  const direct = Number(race.latest.courseMile ?? race.latest.courseMileLabel);
  if (Number.isFinite(direct)) return direct;

  const current = Number(race.latest.gpxMile);
  let prior = { gpxMile: 0, courseMile: 0 };
  let next = stations[stations.length - 1];

  for (const station of stations) {
    if (station.gpxMile <= current) prior = station;
    if (station.gpxMile >= current) {
      next = station;
      break;
    }
  }

  const span = next.gpxMile - prior.gpxMile;
  if (span <= 0) return Number(prior.courseMile);
  const ratio = (current - prior.gpxMile) / span;
  return Number(prior.courseMile) + ratio * (Number(next.courseMile) - Number(prior.courseMile));
}

function projectedStations(stations, latestTime, sliderPercent) {
  const factor = 1 + sliderPercent / 100;
  return stations.map((station) => {
    const etaLow = new Date(station.etaLo);
    const etaHigh = new Date(station.etaHi);

    if (station.status === "passed" || sliderPercent === 0) {
      return { ...station, projectedLow: etaLow, projectedHigh: etaHigh };
    }

    const lowMinutes = (etaLow - latestTime) / 60000;
    const highMinutes = (etaHigh - latestTime) / 60000;

    return {
      ...station,
      projectedLow: addMinutes(latestTime, lowMinutes / factor),
      projectedHigh: addMinutes(latestTime, highMinutes / factor),
    };
  });
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function project(lat, lon, bounds, width, height, padding = 70) {
  const meanLatitude = (bounds.minLat + bounds.maxLat) / 2;
  const xScale = Math.cos((meanLatitude * Math.PI) / 180);
  const longitudeRange = (bounds.maxLon - bounds.minLon) * xScale;
  const latitudeRange = bounds.maxLat - bounds.minLat;
  const scale = Math.min(
    (width - 2 * padding) / longitudeRange,
    (height - 2 * padding) / latitudeRange
  );

  return {
    x: padding + (lon - bounds.minLon) * xScale * scale,
    y: height - padding - (lat - bounds.minLat) * scale,
  };
}

function buildMap(svg, course, race, stations, state) {
  const width = 1120;
  const height = 760;
  const route = course.route;
  const currentGpxMile = Number(race.latest.gpxMile);

  const bounds = {
    minLat: Math.min(...route.map((point) => point.lat)),
    maxLat: Math.max(...route.map((point) => point.lat)),
    minLon: Math.min(...route.map((point) => point.lon)),
    maxLon: Math.max(...route.map((point) => point.lon)),
  };

  const routePoints = route.map((point) => ({
    ...project(point.lat, point.lon, bounds, width, height),
    mile: point.mile,
  }));

  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.append(
    svgElement("polyline", {
      points: routePoints.map((point) => `${point.x},${point.y}`).join(" "),
      fill: "none",
      stroke: "#76847c",
      "stroke-width": "7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    })
  );

  const completed = routePoints.filter((point) => point.mile <= currentGpxMile);
  svg.append(
    svgElement("polyline", {
      points: completed.map((point) => `${point.x},${point.y}`).join(" "),
      fill: "none",
      stroke: "#3f8f67",
      "stroke-width": "10",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    })
  );

  const labelOffsets = [
    [-130, -30], [-145, 34], [-120, 42], [18, -36], [18, -20], [18, 0], [18, 22],
    [18, 44], [18, 64], [-145, -10], [-140, 12], [-135, 38], [18, 28], [18, 48],
  ];

  stations.forEach((station, index) => {
    const point = project(station.lat, station.lon, bounds, width, height);
    const group = svgElement("g", { class: "station-node", tabindex: "0" });
    const color =
      station.status === "next" ? "#c48b2c" :
      station.status === "passed" ? "#95a19a" :
      station.name === "Finish" ? "#b85f37" : "#15382b";

    group.append(
      svgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: station.status === "next" ? 10 : 7,
        fill: color,
        stroke: "#fff",
        "stroke-width": "3",
      })
    );

    const [dx, dy] = labelOffsets[index] || [14, 14];
    const label = svgElement("text", {
      x: point.x + dx,
      y: point.y + dy,
      class: "station-label",
    });
    label.textContent = `${index + 1}. ${station.name}`;
    group.append(label);

    const mile = svgElement("text", {
      x: point.x + dx,
      y: point.y + dy + 15,
      class: "station-mile",
    });
    mile.textContent = `Mile ${station.courseMile}${station.cutoff ? " · cutoff" : ""}`;
    group.append(mile);

    const show = () => state.showStation(index);
    group.addEventListener("click", show);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show();
      }
    });
    svg.append(group);
  });

  const runner = project(race.latest.lat, race.latest.lon, bounds, width, height);
  const nextStation = stations.find((station) => station.status === "next");
  if (nextStation) {
    const nextPoint = project(nextStation.lat, nextStation.lon, bounds, width, height);
    svg.append(
      svgElement("line", {
        x1: runner.x,
        y1: runner.y,
        x2: nextPoint.x,
        y2: nextPoint.y,
        stroke: "#c48b2c",
        "stroke-width": "5",
        "stroke-dasharray": "10 9",
        "stroke-linecap": "round",
        opacity: "0.95",
      })
    );
  }

  svg.append(
    svgElement("circle", {
      cx: runner.x, cy: runner.y, r: 24,
      fill: "none", stroke: "#3f8f67", "stroke-width": "4",
      class: "runner-pulse",
    })
  );
  svg.append(
    svgElement("circle", {
      cx: runner.x, cy: runner.y, r: 14,
      fill: "#3f8f67", stroke: "#fff", "stroke-width": "5",
    })
  );

  const runnerLabelBg = svgElement("rect", {
    x: runner.x + 20,
    y: runner.y - 34,
    width: "150",
    height: "48",
    rx: "10",
    fill: "#ffffff",
    stroke: "#285b43",
    "stroke-width": "2",
    opacity: "0.96",
  });
  svg.append(runnerLabelBg);

  const runnerLabel = svgElement("text", {
    x: runner.x + 32,
    y: runner.y - 14,
    fill: "#15382b",
    "font-weight": "900",
    "font-size": "15",
  });
  runnerLabel.textContent = `Nate · mile ${getCourseMile(race, stations).toFixed(1)}`;
  svg.append(runnerLabel);

  const runnerTime = svgElement("text", {
    x: runner.x + 32,
    y: runner.y + 4,
    fill: "#52615a",
    "font-weight": "700",
    "font-size": "12",
  });
  runnerTime.textContent = `Updated ${formatTime(new Date(race.latest.time))}`;
  svg.append(runnerTime);

  const defaultView = { x: 0, y: 0, w: width, h: height };
  let view = { ...defaultView };
  let dragging = false;
  let last = { x: 0, y: 0 };

  function apply() {
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  }

  function zoom(multiplier) {
    const centerX = view.x + view.w / 2;
    const centerY = view.y + view.h / 2;
    view.w = Math.max(360, Math.min(1500, view.w * multiplier));
    view.h = view.w * height / width;
    view.x = centerX - view.w / 2;
    view.y = centerY - view.h / 2;
    apply();
  }

  state.zoomIn = () => zoom(0.82);
  state.zoomOut = () => zoom(1.22);
  state.reset = () => {
    view = { ...defaultView };
    apply();
  };
  state.focusRunner = () => {
    view = { x: runner.x - 250, y: runner.y - 170, w: 500, h: 340 };
    apply();
  };

  svg.addEventListener("pointerdown", (event) => {
    dragging = true;
    last = { x: event.clientX, y: event.clientY };
    svg.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    view.x -= (event.clientX - last.x) * view.w / rect.width;
    view.y -= (event.clientY - last.y) * view.h / rect.height;
    last = { x: event.clientX, y: event.clientY };
    apply();
  });
  svg.addEventListener("pointerup", () => { dragging = false; });
  svg.addEventListener("pointercancel", () => { dragging = false; });
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.12 : 0.89);
  }, { passive: false });
}

function buildElevation(svg, currentCourseMile, totalCourseMiles) {
  const legs = [
    [0,15,4300,3200],[15,25,1500,1500],[25,31,950,2400],[31,42,2000,4500],
    [42,47,1850,1750],[47,51,900,100],[51,53,950,350],[53,65,2800,2800],
    [65,67,350,950],[67,76,3200,950],[76,88,1700,4800],[88,92,900,100],
    [92,101,3200,940],[101,104,415,600],
  ];

  const profile = [[0, 1200]];
  let elevation = 1200;
  legs.forEach(([start, end, gain, loss]) => {
    profile.push([start + (end - start) * 0.48, elevation + gain]);
    elevation = elevation + gain - loss;
    profile.push([end, elevation]);
  });

  const values = profile.map((point) => point[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 1100;
  const height = 330;
  const padding = 50;
  const x = (mile) => padding + mile / totalCourseMiles * (width - 2 * padding);
  const y = (value) => height - padding - (value - min) / (max - min) * (height - 2 * padding);

  svg.innerHTML = "";
  const points = profile.map(([mile, value]) => `${x(mile)},${y(value)}`).join(" ");
  svg.append(svgElement("polyline", {
    points, fill: "none", stroke: "#285b43", "stroke-width": "3",
  }));

  const markerX = x(currentCourseMile);
  svg.append(svgElement("line", {
    x1: markerX, y1: padding, x2: markerX, y2: height - padding,
    stroke: "#b85f37", "stroke-width": "3", "stroke-dasharray": "8 7",
  }));

  const label = svgElement("text", {
    x: markerX + 10, y: 28, fill: "#b85f37",
    "font-weight": "900", "font-size": "15",
  });
  label.textContent = `Mile ${currentCourseMile.toFixed(1)}`;
  svg.append(label);
}

async function main() {
  const [race, course] = await Promise.all([loadJSON("race.json"), loadJSON("course.json")]);

  if (!race?.latest || !Array.isArray(course?.route) || !Array.isArray(course?.stations)) {
    throw new Error("race.json or course.json has an invalid structure.");
  }

  const latestTime = new Date(race.latest.time);
  const stations = deriveStatuses(course.stations, Number(race.latest.gpxMile));
  const section = deriveSection(stations, Number(race.latest.gpxMile));
  const courseMile = getCourseMile(race, stations);
  const finish = stations.find((station) => station.name === "Finish") || stations.at(-1);
  const totalCourseMiles = Number(finish.courseMile);
  const progressPercent = Math.max(0, Math.min(100, courseMile / totalCourseMiles * 100));

  byId("runnerName").textContent = race.runner;
  byId("currentMile").textContent = courseMile.toFixed(1);
  byId("lastUpdated").textContent = race.lastUpdatedLabel || formatDateTime(latestTime);
  byId("currentSection").textContent = section.section;
  byId("currentNote").textContent = section.note;
  byId("progressPercent").textContent = Math.round(progressPercent);
  byId("progressMiles").textContent = courseMile.toFixed(1);
  byId("totalMiles").textContent = totalCourseMiles.toFixed(1);
  byId("progressFill").style.width = `${progressPercent}%`;
  byId("glancePing").textContent = formatTime(latestTime);
  byId("glanceMile").textContent = courseMile.toFixed(1);
  byId("crewBase").textContent = `Crew base: ${race.crewBase?.name || "Avid Hotel Wenatchee"}`;

  const popover = byId("mapPopover");
  popover.innerHTML = `
    <strong>Latest confirmed</strong>
    <span>Mile ${courseMile.toFixed(1)} at ${formatTime(latestTime)}</span>
    <span>${section.section}</span>
  `;

  const state = {};
  let currentProjection = [];

  state.showStation = (index) => {
    const station = currentProjection[index] || stations[index];
    let html = `
      <strong>${station.name}</strong>
      <span>Course mile ${station.courseMile}</span>
      <span>${station.status === "passed" ? "Passed" : `ETA: ${formatWindow(station.projectedLow, station.projectedHigh)}`}</span>
    `;
    if (station.cutoff) {
      const cutoff = new Date(station.cutoff);
      const buffer = (cutoff - station.projectedHigh) / 60000;
      html += `<span>Cutoff: ${formatDateTime(cutoff)}</span><span>Buffer: ${bufferText(buffer)}</span>`;
    }
    popover.innerHTML = html;
  };

  function renderProjection() {
    const sliderPercent = Number(byId("paceSlider").value);
    currentProjection = projectedStations(stations, latestTime, sliderPercent);
    const next = currentProjection.find((station) => station.status === "next");
    const projectedFinish = currentProjection.find((station) => station.name === "Finish") || currentProjection.at(-1);

    byId("scenarioLabel").textContent =
      sliderPercent === 0
        ? "Baseline"
        : `${sliderPercent > 0 ? "+" : ""}${sliderPercent}% ${sliderPercent > 0 ? "faster" : "slower"}`;

    if (next) {
      const nextText = formatWindow(next.projectedLow, next.projectedHigh);
      byId("nextStationName").textContent = next.name;
      byId("nextStationEta").textContent = nextText;
      byId("nextStationMeta").textContent = `Course mile ${next.courseMile}`;
      byId("glanceNext").textContent = nextText;
    } else {
      byId("nextStationName").textContent = "Finish";
      byId("nextStationEta").textContent = "Final approach";
      byId("nextStationMeta").textContent = `Course mile ${totalCourseMiles}`;
      byId("glanceNext").textContent = "Finish";
    }

    byId("heroFinish").textContent = formatWindow(
      projectedFinish.projectedLow,
      projectedFinish.projectedHigh
    );

    byId("stationCards").innerHTML = currentProjection
      .filter((station) => station.status !== "passed")
      .slice(0, 3)
      .map((station, index) => `
        <article class="station-card ${index === 0 ? "next" : ""}">
          <span>${index === 0 ? "Next" : "Upcoming"} · mile ${station.courseMile}</span>
          <strong>${station.name}</strong>
          <div>${formatWindow(station.projectedLow, station.projectedHigh)}</div>
        </article>
      `).join("");

    byId("projectionTable").innerHTML = currentProjection.map((station) => {
      const cutoff = station.cutoff ? new Date(station.cutoff) : null;
      const buffer = cutoff ? (cutoff - station.projectedHigh) / 60000 : null;
      const bufferClass =
        buffer === null ? "" :
        buffer < 0 ? "buffer-danger" :
        buffer < 120 ? "buffer-watch" : "buffer-good";

      return `
        <tr class="${station.status === "passed" ? "passed" : station.status === "next" ? "next" : ""}">
          <td><strong>${station.name}</strong></td>
          <td>${station.courseMile}</td>
          <td>${station.status === "passed" ? "Passed" : formatWindow(station.projectedLow, station.projectedHigh)}</td>
          <td>${cutoff ? formatDateTime(cutoff) : "—"}</td>
          <td class="${bufferClass}">${buffer === null ? "—" : bufferText(buffer)}</td>
        </tr>
      `;
    }).join("");

    const crewStations = currentProjection.filter((station) =>
      station.crew === "Crew accessible" || station.crew === "Accessible, not recommended"
    );
    const nextCrew = crewStations.find((station) => station.status !== "passed");

    byId("crewStops").innerHTML = crewStations.map((station) => `
      <article class="crew-stop ${nextCrew?.name === station.name ? "next-crew" : ""}">
        <span>${station.status === "passed" ? "Passed" : nextCrew?.name === station.name ? "Next crew stop" : "Upcoming"} · course mile ${station.courseMile}</span>
        <strong>${station.name}</strong>
        <div>${station.status === "passed" ? "Passed" : formatWindow(station.projectedLow, station.projectedHigh)}</div>
        <span>${station.crew}</span>
        <span>${station.driveNote || ""}</span>
      </article>
    `).join("");
  }

  byId("paceSlider").addEventListener("input", renderProjection);
  renderProjection();

  buildMap(byId("courseMap"), course, race, stations, state);
  buildElevation(byId("elevationChart"), courseMile, totalCourseMiles);

  byId("zoomIn").onclick = () => state.zoomIn();
  byId("zoomOut").onclick = () => state.zoomOut();
  byId("focusRunner").onclick = () => state.focusRunner();
  byId("resetMap").onclick = () => state.reset();

  const checkins = race.checkins || [];
  byId("checkinCards").innerHTML = checkins.slice(-4).reverse().map((checkin) => {
    const time = new Date(checkin.time);
    const pace = checkin.segmentMph == null
      ? "First point"
      : `${Number(checkin.segmentMph).toFixed(2)} mph since prior pin`;

    return `
      <article class="checkin-card">
        <span>${formatDateTime(time)} · GPX mile ${Number(checkin.gpxMile).toFixed(2)}</span>
        <strong>${pace}</strong>
        <span>${Number(checkin.lat).toFixed(5)}, ${Number(checkin.lon).toFixed(5)}</span>
      </article>
    `;
  }).join("");

  const email = race.messageEmail || "";
  byId("messageButton").href =
    `mailto:${email}?subject=${encodeURIComponent(`Message for ${race.runner} after Devil's Gulch`)}` +
    `&body=${encodeURIComponent(`Hey ${race.runner},\n\nWe were following along and wanted to say:\n\n`)}`;
}

main().catch((error) => {
  console.error(error);
  byId("lastUpdated").textContent = "Live data unavailable";
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div style="position:fixed;left:12px;right:12px;bottom:12px;padding:14px;background:#fff0ed;border:1px solid #a33e31;border-radius:12px;color:#7a241c;z-index:99">
      Tracker data failed to load. Refresh the page.
    </div>`
  );
});

window.setTimeout(() => window.location.reload(), DATA_REFRESH_MS);
