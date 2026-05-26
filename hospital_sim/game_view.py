from __future__ import annotations

import json
from typing import Any

from .architecture import GAME_ROOM_BY_RESOURCE, game_layouts_from_blocks
from .engine import Patient, SimulationResult


ROOMS: dict[str, dict[str, Any]] = {
    "entrance": {"label": "Entrada", "kind": "flow", "floor": 0},
    "triage": {"label": "Triaje", "kind": "ed", "floor": 0},
    "admission": {"label": "Admision", "kind": "support", "floor": 0},
    "ed": {"label": "Urgencias", "kind": "ed", "floor": 0},
    "consults": {"label": "Consultas", "kind": "clinic", "floor": 0},
    "lab": {"label": "Laboratorio", "kind": "diagnostic", "floor": -1},
    "imaging": {"label": "Imagen", "kind": "diagnostic", "floor": -1},
    "or": {"label": "Quirofano", "kind": "surgery", "floor": 1},
    "pacu": {"label": "PACU", "kind": "surgery", "floor": 1},
    "ward": {"label": "Ward", "kind": "bed", "floor": 2},
    "icu": {"label": "UCI", "kind": "critical", "floor": 1},
    "pharmacy": {"label": "Farmacia", "kind": "support", "floor": 0},
    "discharge": {"label": "Alta", "kind": "support", "floor": 0},
    "exit": {"label": "Salida", "kind": "flow", "floor": 0},
}

STAGE_ROOM: tuple[tuple[str, str], ...] = (
    ("arrival", "entrance"),
    ("triage_start", "triage"),
    ("registration_start", "admission"),
    ("preop_start", "admission"),
    ("ed_bay_start", "ed"),
    ("ed_assessment_start", "ed"),
    ("ed_reassessment_start", "ed"),
    ("consultation_start", "consults"),
    ("lab_start", "lab"),
    ("imaging_start", "imaging"),
    ("or_start", "or"),
    ("pacu_start", "pacu"),
    ("ward_bed_start", "ward"),
    ("icu_bed_start", "icu"),
    ("pharmacy_start", "pharmacy"),
    ("discharge_start", "discharge"),
    ("departure", "exit"),
)

ROOM_CAPACITY_FIELD = {
    "triage": "triage_nurses",
    "admission": "registration_clerks",
    "ed": "ed_bays",
    "consults": "outpatient_clinicians",
    "lab": "lab_slots",
    "imaging": "imaging_rooms",
    "or": "operating_rooms",
    "pacu": "pacu_beds",
    "ward": "ward_beds",
    "icu": "icu_beds",
    "pharmacy": "pharmacy_windows",
    "discharge": "discharge_coordinators",
}


def build_game_payload(result: SimulationResult, max_patients: int = 950, layout_blocks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    patients = [p for p in result.patients if p.completed and p.departure_time is not None]
    patients.sort(key=lambda p: (p.arrival_time, p.patient_id))
    selected = patients[:max_patients]
    duration = max((p.departure_time or p.arrival_time for p in selected), default=result.config.duration_minutes)
    capacities = result.config.resolved_capacities()
    room_capacity = {
        room: getattr(capacities, field)
        for room, field in ROOM_CAPACITY_FIELD.items()
    }
    room_capacity["entrance"] = 70
    room_capacity["exit"] = 70
    room_capacity["elevator"] = capacities.elevators
    layouts = game_layouts_from_blocks(layout_blocks or []) if layout_blocks else {}
    room_floors = _room_floor_overrides(result)
    return {
        "rooms": ROOMS,
        "capacities": room_capacity,
        "patients": [_patient_route(patient, room_floors) for patient in selected],
        "duration": round(duration, 1),
        "warmup": result.config.warmup_minutes,
        "architecture": result.config.architecture_name,
        "layouts": layouts,
        "floors": sorted(int(floor) for floor in layouts) if layouts else [-1, 0, 1, 2],
        "kpis": {
            "edLosP90": round(result.kpis["ed_los_p90_min"], 1),
            "boardingP90": round(result.kpis["boarding_p90_min"], 1),
            "pacuP90": round(result.kpis["pacu_boarding_p90_min"], 1),
            "elevatorP90": round(result.kpis.get("elevator_wait_p90_min", 0), 1),
            "resourcesHot": int(result.kpis["resources_over_85pct"]),
        },
        "bottlenecks": result.bottlenecks[:5],
    }


def render_game_view(payload: dict[str, Any]) -> str:
    data = json.dumps(payload, separators=(",", ":"))
    return GAME_HTML.replace("__PAYLOAD__", data)


def _room_floor_overrides(result: SimulationResult) -> dict[str, int]:
    floors: dict[str, int] = {}
    for location in result.config.resource_locations:
        room = GAME_ROOM_BY_RESOURCE.get(location.resource)
        if room is not None:
            floors[room] = location.floor
    return floors


def _patient_route(patient: Patient, room_floors: dict[str, int] | None = None) -> dict[str, Any]:
    room_floors = room_floors or {}
    events: list[tuple[float, str]] = []
    for key, room in STAGE_ROOM:
        if key in patient.stages:
            events.append((patient.stages[key], room))
    events.sort(key=lambda item: item[0])
    compressed: list[dict[str, Any]] = []
    for time, room in events:
        if compressed and compressed[-1]["room"] == room:
            continue
        compressed.append({"t": round(time, 1), "room": room, "floor": room_floors.get(room, ROOMS[room]["floor"])})
    if not compressed:
        compressed.append({"t": round(patient.arrival_time, 1), "room": "entrance", "floor": 0})
    if compressed[-1]["room"] != "exit" and patient.departure_time is not None:
        compressed.append({"t": round(patient.departure_time, 1), "room": "exit", "floor": 0})
    return {
        "id": patient.patient_id,
        "stream": patient.stream,
        "severity": patient.severity,
        "admitted": patient.admitted,
        "destination": patient.destination,
        "route": compressed,
    }


GAME_HTML = """
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #e8efe3;
    color: #1e2931;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .shell {
    border: 1px solid #c9d6d1;
    border-radius: 8px;
    overflow: hidden;
    background: #f7faf7;
  }
  .topbar, .hud {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 10px 12px;
    background: #ffffff;
    border-bottom: 1px solid #c9d6d1;
  }
  .hud {
    grid-template-columns: 1fr 132px;
    background: #f7faf7;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .title strong {
    font-size: 16px;
  }
  .clock {
    color: #66737b;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .controls {
    display: flex;
    gap: 7px;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  button, select {
    height: 32px;
    border: 1px solid #ccd8d3;
    border-radius: 6px;
    background: #ffffff;
    color: #1e2931;
    font: inherit;
    font-size: 13px;
  }
  button {
    width: 38px;
    cursor: pointer;
    font-weight: 800;
  }
  select {
    min-width: 126px;
    padding: 0 9px;
  }
  input[type="range"] {
    width: 100%;
    accent-color: #2a9d8f;
  }
  .chips {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 7px;
    padding: 9px 12px;
    background: #ffffff;
    border-bottom: 1px solid #c9d6d1;
  }
  .chip {
    min-height: 54px;
    border: 1px solid #dce6e1;
    border-radius: 7px;
    background: #fbfdfb;
    padding: 7px 9px;
  }
  .chip span {
    display: block;
    color: #66737b;
    font-size: 11px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip strong {
    display: block;
    margin-top: 5px;
    font-size: 17px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stage {
    position: relative;
    min-height: 610px;
    background: #78d957;
  }
  #game {
    height: 610px;
    width: 100%;
  }
  canvas {
    display: block;
    image-rendering: pixelated;
  }
  .fallback {
    padding: 18px;
    font-size: 14px;
  }
  .legend {
    position: absolute;
    right: 12px;
    bottom: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    align-items: center;
    padding: 8px 10px;
    border: 2px solid rgba(49, 80, 67, 0.22);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.92);
    font-size: 12px;
    pointer-events: none;
  }
  .key {
    width: 12px;
    height: 12px;
    display: inline-block;
    margin-right: 5px;
    vertical-align: -2px;
    border: 2px solid #315043;
  }
  @media (max-width: 820px) {
    .topbar, .hud { grid-template-columns: 1fr; }
    .controls { justify-content: flex-start; }
    .chips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
</head>
<body>
<div class="shell">
  <div class="topbar">
    <div class="title">
      <strong>Hospital RPG Simulator</strong>
      <span class="clock" id="clock">Dia 1 00:00</span>
    </div>
    <div class="controls">
      <button id="play" title="Play/Pausa">||</button>
      <select id="speed" title="Velocidad">
        <option value="30">30x</option>
        <option value="90" selected>90x</option>
        <option value="240">240x</option>
        <option value="720">720x</option>
      </select>
      <select id="floor" title="Planta">
        <option value="-1">Planta -1</option>
        <option value="0" selected>Planta 0</option>
        <option value="1">Planta 1</option>
        <option value="2">Planta 2</option>
      </select>
      <select id="viewMode" title="Capa visual">
        <option value="rpg" selected>RPG</option>
        <option value="heat">Calor</option>
        <option value="architect">Arquitecto</option>
      </select>
      <button id="reset" title="Reiniciar">R</button>
    </div>
  </div>
  <div class="hud">
    <input id="time" type="range" min="0" max="1000" value="0">
    <div class="clock" id="timeLabel">0.0 h</div>
  </div>
  <div class="chips">
    <div class="chip"><span>Pacientes en planta</span><strong id="activeCount">0</strong></div>
    <div class="chip"><span>Area mas cargada</span><strong id="hotRoom">-</strong></div>
    <div class="chip"><span>Boarding ED P90</span><strong id="boardingStat">0.0 h</strong></div>
    <div class="chip"><span>Ascensor P90</span><strong id="elevatorStat">0.0 min</strong></div>
    <div class="chip"><span>Alertas</span><strong id="alertStat">0</strong></div>
  </div>
  <div class="stage">
    <div id="game"></div>
    <div class="legend">
      <span><i class="key" style="background:#d62828"></i>grave</span>
      <span><i class="key" style="background:#f4a261"></i>moderado</span>
      <span><i class="key" style="background:#2a9d8f"></i>leve</span>
      <span><i class="key" style="background:#4f83cc"></i>personal</span>
    </div>
  </div>
</div>
<script>
const payload = __PAYLOAD__;
const patients = payload.patients;
const capacities = payload.capacities;
const roomsMeta = payload.rooms;
const clock = document.getElementById("clock");
const timeLabel = document.getElementById("timeLabel");
const activeCount = document.getElementById("activeCount");
const hotRoom = document.getElementById("hotRoom");
const boardingStat = document.getElementById("boardingStat");
const elevatorStat = document.getElementById("elevatorStat");
const alertStat = document.getElementById("alertStat");
const playButton = document.getElementById("play");
const resetButton = document.getElementById("reset");
const speedSelect = document.getElementById("speed");
const floorSelect = document.getElementById("floor");
const viewModeSelect = document.getElementById("viewMode");
const timeSlider = document.getElementById("time");

let currentTime = payload.warmup || 0;
let playing = true;
const availableFloors = payload.floors || [-1, 0, 1, 2];
floorSelect.innerHTML = availableFloors.map(floor => `<option value="${floor}">Planta ${floor}</option>`).join("");
let selectedFloor = availableFloors.includes(0) ? 0 : availableFloors[0];
floorSelect.value = String(selectedFloor);
let viewMode = "rpg";
let lastFloor = null;
const maxTime = Math.max(payload.duration, currentTime + 60);
timeSlider.max = Math.round(maxTime);
timeSlider.value = Math.round(currentTime);
boardingStat.textContent = (payload.kpis.boardingP90 / 60).toFixed(1) + " h";
elevatorStat.textContent = payload.kpis.elevatorP90.toFixed(1) + " min";
alertStat.textContent = String(payload.kpis.resourcesHot);

const MAP_W = 52;
const MAP_H = 30;
const elevatorCore = { x: 24, y: 13, w: 4, h: 4, label: "Ascensor", kind: "vertical", floor: null };
const defaultLayouts = {
  "-1": {
    lab: { x: 9, y: 6, w: 15, h: 9 },
    imaging: { x: 30, y: 6, w: 13, h: 9 },
    elevator: elevatorCore,
  },
  "0": {
    entrance: { x: 1, y: 13, w: 4, h: 4 },
    triage: { x: 7, y: 3, w: 8, h: 6 },
    admission: { x: 7, y: 11, w: 8, h: 5 },
    ed: { x: 17, y: 3, w: 12, h: 8 },
    consults: { x: 17, y: 17, w: 11, h: 7 },
    pharmacy: { x: 42, y: 22, w: 7, h: 5 },
    discharge: { x: 7, y: 22, w: 8, h: 5 },
    exit: { x: 1, y: 22, w: 4, h: 4 },
    elevator: elevatorCore,
  },
  "1": {
    or: { x: 8, y: 6, w: 12, h: 8 },
    pacu: { x: 28, y: 6, w: 12, h: 8 },
    icu: { x: 30, y: 19, w: 14, h: 8 },
    elevator: elevatorCore,
  },
  "2": {
    ward: { x: 7, y: 6, w: 38, h: 17 },
    elevator: elevatorCore,
  },
};

const layouts = Object.keys(payload.layouts || {}).length ? payload.layouts : defaultLayouts;

for (const floorRooms of Object.values(layouts)) {
  for (const [key, room] of Object.entries(floorRooms)) {
    const meta = roomsMeta[key] || {};
    room.label = room.label || meta.label || key;
    room.kind = room.kind || meta.kind || "support";
    room.floor = room.floor ?? meta.floor;
  }
}

const roomColors = {
  flow: 0xd9e9c9, ed: 0xf0c98f, support: 0xdfcfec, clinic: 0xc8e6d0,
  diagnostic: 0xbdd8e7, surgery: 0xf2df9b, bed: 0xc8e6d0, critical: 0xf3b1a6, vertical: 0xcfd8dd
};
const floorPattern = {
  flow: 0xc9dcba, ed: 0xdfb66d, support: 0xc7b5d9, clinic: 0xa9d4b2,
  diagnostic: 0x9fc1d4, surgery: 0xd5c06e, bed: 0xa9d4b2, critical: 0xdd8f84, vertical: 0x9baab2
};
const PMath = window.Phaser?.Math || {
  Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2) },
  Linear: (a, b, t) => a + (b - a) * t,
};
const severityColor = { severe: 0xd62828, moderate: 0xf4a261, mild: 0x2a9d8f };
const streamTrim = { ed: 0x293241, outpatient: 0x4f83cc, elective: 0x7c6bb0 };
const staff = {
  "-1": [["lab", 15, 10, "tech"], ["imaging", 35, 10, "tech"]],
  "0": [["triage", 10, 6, "nurse"], ["admission", 10, 13, "admin"], ["ed", 23, 7, "doctor"], ["consults", 22, 20, "doctor"], ["pharmacy", 45, 24, "pharm"], ["discharge", 11, 24, "admin"]],
  "1": [["or", 14, 10, "doctor"], ["pacu", 34, 10, "nurse"], ["icu", 37, 23, "doctor"]],
  "2": [["ward", 15, 12, "nurse"], ["ward", 28, 16, "nurse"], ["ward", 39, 12, "doctor"]],
};

function roomFloor(room) {
  if (room === "elevator") return selectedFloor;
  return roomsMeta[room]?.floor ?? 0;
}

function roomLayout(room, floor = selectedFloor) {
  const floorRooms = layouts[String(floor)] || {};
  if (room === "elevator") return floorRooms.elevator;
  return floorRooms[room] || layouts[String(roomFloor(room))]?.[room];
}

function pointFor(room, floor = selectedFloor) {
  const r = roomLayout(room, floor);
  if (!r) return { x: 26, y: 15 };
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function formatClock(minutes) {
  const day = Math.floor(minutes / 1440) + 1;
  const minuteOfDay = Math.floor(minutes % 1440);
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  return `Dia ${day} ${hh}:${mm}`;
}

function patientPosition(patient, time, floor) {
  const route = patient.route;
  if (!route.length || time < route[0].t || time > route[route.length - 1].t) return null;
  for (let i = 0; i < route.length - 1; i++) {
    const current = route[i];
    const next = route[i + 1];
    if (time >= current.t && time <= next.t) {
      const currentFloor = current.floor;
      const nextFloor = next.floor;
      const travel = Math.min(36, Math.max(8, (next.t - current.t) * 0.24));
      const moveStart = Math.max(current.t, next.t - travel);
      if (time < moveStart || current.room === next.room) {
        if (currentFloor !== floor) return null;
        return jitter(pointFor(current.room, floor), patient.id, current.room, false, floor);
      }
      const raw = (time - moveStart) / Math.max(1, next.t - moveStart);
      const p = Math.min(1, Math.max(0, raw));
      const eased = p * p * (3 - 2 * p);
      if (currentFloor === nextFloor) {
        if (floor !== currentFloor) return null;
        return interpolatePath(pathBetween(current.room, next.room, floor), eased, next.room, true, floor);
      }
      if (floor === currentFloor && eased < 0.52) {
        return interpolatePath(pathBetween(current.room, "elevator", floor), eased / 0.52, "elevator", true, floor);
      }
      if (floor === nextFloor && eased >= 0.48) {
        return interpolatePath(pathBetween("elevator", next.room, floor), (eased - 0.48) / 0.52, next.room, true, floor);
      }
      return null;
    }
  }
  const last = route[route.length - 1];
  if (last.floor !== floor) return null;
  return jitter(pointFor(last.room, floor), patient.id, last.room, false, floor);
}

function pathBetween(from, to, floor) {
  const a = pointFor(from, floor);
  const b = pointFor(to, floor);
  const hub = { x: 26, y: 15 };
  if (from === "elevator" || to === "elevator") {
    return [a, b];
  }
  return [a, { x: a.x, y: hub.y }, { x: b.x, y: hub.y }, b];
}

function interpolatePath(points, t, room, moving, floor) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += PMath.Distance.Between(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
  let target = total * t;
  for (let i = 0; i < points.length - 1; i++) {
    const d = PMath.Distance.Between(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    if (target <= d || i === points.length - 2) {
      const p = d === 0 ? 0 : target / d;
      return {
        x: PMath.Linear(points[i].x, points[i + 1].x, p),
        y: PMath.Linear(points[i].y, points[i + 1].y, p),
        room,
        moving,
        floor,
      };
    }
    target -= d;
  }
  return { ...points[points.length - 1], room, moving, floor };
}

function jitter(point, id, room, moving, floor) {
  const spread = room === "ward" ? 2.2 : room === "ed" ? 1.6 : 0.85;
  const angle = (id * 137.5 % 360) * Math.PI / 180;
  const radius = ((id * 37) % 100) / 100 * spread;
  return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius, room, moving, floor };
}

function occupancyAt(time, floor) {
  const counts = {};
  const active = [];
  for (const p of patients) {
    const pos = patientPosition(p, time, floor);
    if (!pos) continue;
    active.push([p, pos]);
    if (!pos.moving) counts[pos.room] = (counts[pos.room] || 0) + 1;
  }
  return { counts, active };
}

function hotArea(counts) {
  let hot = "-";
  let score = -1;
  for (const [room, count] of Object.entries(counts)) {
    const cap = capacities[room] || 1;
    const pressure = count / cap;
    if (room !== "entrance" && room !== "exit" && pressure > score) {
      score = pressure;
      hot = roomLayout(room)?.label || room;
    }
  }
  return hot;
}

function updateHud(counts, active) {
  activeCount.textContent = String(active.length);
  hotRoom.textContent = hotArea(counts);
  clock.textContent = formatClock(currentTime);
  timeLabel.textContent = (currentTime / 60).toFixed(1) + " h";
  timeSlider.value = String(Math.round(currentTime));
}

function hex(color) {
  return "#" + color.toString(16).padStart(6, "0");
}

function startCanvasFallback() {
  const host = document.getElementById("game");
  const canvas = document.createElement("canvas");
  host.innerHTML = "";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let tile = 12;
  let ox = 0;
  let oy = 0;
  function resize() {
    const rect = host.getBoundingClientRect();
    canvas.width = Math.max(520, Math.floor(rect.width));
    canvas.height = Math.max(520, Math.floor(rect.height));
    tile = Math.max(10, Math.floor(Math.min(canvas.width / MAP_W, canvas.height / MAP_H)));
    ox = Math.floor((canvas.width - MAP_W * tile) / 2);
    oy = Math.floor((canvas.height - MAP_H * tile) / 2);
  }
  function rect(x, y, w, h, fill, stroke = "#30473e", alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillRect(ox + x * tile, oy + y * tile, w * tile, h * tile);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, tile * 0.12);
      ctx.strokeRect(ox + x * tile, oy + y * tile, w * tile, h * tile);
    }
    ctx.restore();
  }
  function text(value, x, y, size = 11, weight = "700") {
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    const lines = String(value).split("\\n");
    const max = Math.max(...lines.map(line => line.length));
    ctx.fillRect(ox + x * tile - 3, oy + y * tile - size, max * size * 0.54 + 8, lines.length * (size + 2) + 5);
    ctx.fillStyle = "#26372f";
    ctx.font = `${weight} ${size}px monospace`;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], ox + x * tile, oy + y * tile + i * (size + 2));
  }
  function drawHuman(point, color, trim) {
    const x = ox + point.x * tile;
    const y = oy + point.y * tile;
    const s = tile * 0.92;
    ctx.fillStyle = "rgba(31,41,51,0.22)";
    ctx.fillRect(x - s * 0.28, y + s * 0.22, s * 0.56, s * 0.16);
    ctx.fillStyle = hex(trim);
    ctx.fillRect(x - s * 0.22, y + s * 0.18, s * 0.16, s * 0.32);
    ctx.fillRect(x + s * 0.06, y + s * 0.18, s * 0.16, s * 0.32);
    ctx.fillStyle = hex(color);
    ctx.fillRect(x - s * 0.28, y - s * 0.24, s * 0.56, s * 0.5);
    ctx.fillStyle = "#d8a878";
    ctx.fillRect(x - s * 0.21, y - s * 0.64, s * 0.42, s * 0.36);
    ctx.fillStyle = "#2b2d42";
    ctx.fillRect(x - s * 0.24, y - s * 0.72, s * 0.48, s * 0.16);
  }
  function draw() {
    if (playing) {
      currentTime += 1 / 30 * Number(speedSelect.value);
      if (currentTime > maxTime) currentTime = payload.warmup || 0;
    }
    const { counts, active } = occupancyAt(currentTime, selectedFloor);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    rect(0, 0, MAP_W, MAP_H, selectedFloor === 0 ? "#78d957" : "#d7dbc2", null);
    rect(0, 14, 52, 3, "#d7dbc2", "#b7c0a8");
    rect(24, 0, 4, 30, "#d7dbc2", "#b7c0a8");
    rect(0, 23, 52, 3, "#d7dbc2", "#b7c0a8");
    const floorRooms = layouts[String(selectedFloor)] || {};
    for (const [key, room] of Object.entries(floorRooms)) {
      const count = counts[key] || 0;
      const pressure = Math.min(1, count / (capacities[key] || 1));
      rect(room.x, room.y, room.w, room.h, hex(roomColors[room.kind] || 0xdedede), pressure >= 0.95 ? "#d62828" : "#30473e");
      if (viewMode === "heat" && pressure > 0.15) rect(room.x, room.y, room.w, room.h, "#d62828", null, 0.16 + pressure * 0.42);
      text(`${room.label}\\n${count}/${capacities[key] || ""}`.trim(), room.x + 0.4, room.y + 1.1, Math.max(9, Math.floor(tile * 0.45)));
    }
    if (viewMode === "architect") {
      ctx.strokeStyle = "rgba(29,78,216,0.42)";
      ctx.lineWidth = Math.max(2, tile * 0.12);
      for (const patient of patients.slice(0, 120)) {
        for (let i = 0; i < patient.route.length - 1; i++) {
          const a = patient.route[i], b = patient.route[i + 1];
          if (a.floor !== selectedFloor && b.floor !== selectedFloor) continue;
          const points = pathBetween(a.floor === selectedFloor ? a.room : "elevator", b.floor === selectedFloor ? b.room : "elevator", selectedFloor);
          ctx.beginPath();
          for (let p = 0; p < points.length; p++) {
            const qx = ox + points[p].x * tile;
            const qy = oy + points[p].y * tile;
            if (p === 0) ctx.moveTo(qx, qy);
            else ctx.lineTo(qx, qy);
          }
          ctx.stroke();
        }
      }
    }
    for (const [patient, pos] of active) {
      drawHuman(pos, severityColor[patient.severity] || 0x2a9d8f, pos.moving ? 0x2f5f9f : (streamTrim[patient.stream] || 0x293241));
    }
    updateHud(counts, active);
    requestAnimationFrame(draw);
  }
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
}

if (!window.Phaser) {
  startCanvasFallback();
} else {
  class HospitalScene extends Phaser.Scene {
    constructor() {
      super("hospital");
      this.lastTick = performance.now();
      this.tile = 16;
      this.ox = 0;
      this.oy = 0;
      this.labels = {};
    }
    create() {
      this.map = this.add.graphics();
      this.routeLayer = this.add.graphics();
      this.actorLayer = this.add.graphics();
      this.labelLayer = this.add.container(0, 0);
      this.scale.on("resize", () => this.relayout());
      this.relayout();
    }
    relayout() {
      const w = this.scale.width;
      const h = this.scale.height;
      this.tile = Math.floor(Math.min(w / MAP_W, h / MAP_H));
      this.tile = Math.max(10, this.tile);
      this.ox = Math.floor((w - MAP_W * this.tile) / 2);
      this.oy = Math.floor((h - MAP_H * this.tile) / 2);
      this.rebuildLabels();
    }
    px(point) {
      return { x: this.ox + point.x * this.tile, y: this.oy + point.y * this.tile };
    }
    rebuildLabels() {
      this.labelLayer.removeAll(true);
      this.labels = {};
      const floorRooms = layouts[String(selectedFloor)] || {};
      for (const [key, room] of Object.entries(floorRooms)) {
        const text = this.add.text(this.ox + (room.x + 0.4) * this.tile, this.oy + (room.y + 0.35) * this.tile, room.label, {
          fontFamily: "monospace",
          fontSize: Math.max(9, Math.floor(this.tile * 0.43)),
          color: "#26372f",
          backgroundColor: "rgba(255,255,255,0.82)",
          padding: { x: 3, y: 2 },
        });
        this.labelLayer.add(text);
        this.labels[key] = text;
      }
    }
    update(_, delta) {
      if (lastFloor !== selectedFloor) {
        lastFloor = selectedFloor;
        this.rebuildLabels();
      }
      if (playing) {
        currentTime += Math.min(250, delta) / 1000 * Number(speedSelect.value);
        if (currentTime > maxTime) currentTime = payload.warmup || 0;
      }
      const { counts, active } = occupancyAt(currentTime, selectedFloor);
      this.draw(counts, active);
      updateHud(counts, active);
    }
    draw(counts, active) {
      this.map.clear();
      this.routeLayer.clear();
      this.actorLayer.clear();
      this.drawGrass();
      this.drawPaths();
      this.drawRooms(counts);
      if (viewMode === "architect") this.drawArchitect(counts);
      if (viewMode === "heat") this.drawHeat(counts);
      this.drawStaff();
      this.drawActors(active);
    }
    rect(g, x, y, w, h, fill, stroke = null, alpha = 1) {
      g.fillStyle(fill, alpha);
      g.fillRect(this.ox + x * this.tile, this.oy + y * this.tile, w * this.tile, h * this.tile);
      if (stroke !== null) {
        g.lineStyle(Math.max(1, this.tile * 0.12), stroke, 1);
        g.strokeRect(this.ox + x * this.tile, this.oy + y * this.tile, w * this.tile, h * this.tile);
      }
    }
    drawGrass() {
      this.rect(this.map, 0, 0, MAP_W, MAP_H, selectedFloor === 0 ? 0x78d957 : 0xd7dbc2);
      if (selectedFloor !== 0) return;
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const n = (x * 31 + y * 17) % 13;
          if (n === 0) this.rect(this.map, x + 0.64, y + 0.25, 0.12, 0.32, 0x65c945);
          if (n === 4) this.rect(this.map, x + 0.22, y + 0.68, 0.18, 0.16, 0x8be566);
        }
      }
      this.drawTree(3, 4);
      this.drawTree(48, 2);
      this.drawTree(50, 27);
    }
    drawTree(x, y) {
      this.rect(this.map, x + 0.38, y + 0.45, 0.24, 0.55, 0x8b5a2b);
      this.rect(this.map, x + 0.12, y + 0.08, 0.76, 0.48, 0x2f9a44);
      this.rect(this.map, x + 0.28, y, 0.44, 0.62, 0x247b39);
    }
    drawPaths() {
      this.rect(this.map, 0, 14, 52, 3, 0xd7dbc2, 0xb7c0a8);
      this.rect(this.map, 24, 0, 4, 30, 0xd7dbc2, 0xb7c0a8);
      this.rect(this.map, 0, 23, 52, 3, 0xd7dbc2, 0xb7c0a8);
      this.map.lineStyle(1, 0xc7cfb7, 1);
      for (let x = 0; x <= MAP_W; x++) {
        this.map.lineBetween(this.ox + x * this.tile, this.oy, this.ox + x * this.tile, this.oy + MAP_H * this.tile);
      }
      for (let y = 0; y <= MAP_H; y++) {
        this.map.lineBetween(this.ox, this.oy + y * this.tile, this.ox + MAP_W * this.tile, this.oy + y * this.tile);
      }
    }
    drawRooms(counts) {
      const floorRooms = layouts[String(selectedFloor)] || {};
      for (const [key, room] of Object.entries(floorRooms)) {
        const count = counts[key] || 0;
        const pressure = Math.min(1, count / (capacities[key] || 1));
        const fill = roomColors[room.kind] || 0xdedede;
        this.rect(this.map, room.x, room.y, room.w, room.h, fill, pressure >= 0.95 ? 0xd62828 : 0x30473e);
        this.map.lineStyle(1, floorPattern[room.kind] || 0xcccccc, 0.6);
        for (let x = room.x; x <= room.x + room.w; x++) {
          this.map.lineBetween(this.ox + x * this.tile, this.oy + room.y * this.tile, this.ox + x * this.tile, this.oy + (room.y + room.h) * this.tile);
        }
        for (let y = room.y; y <= room.y + room.h; y++) {
          this.map.lineBetween(this.ox + room.x * this.tile, this.oy + y * this.tile, this.ox + (room.x + room.w) * this.tile, this.oy + y * this.tile);
        }
        this.drawFurniture(key, room);
        if (this.labels[key]) this.labels[key].setText(`${room.label} ${count}/${capacities[key] || ""}`.trim());
      }
    }
    drawFurniture(key, room) {
      const f = (x, y, w, h, color) => this.rect(this.map, room.x + x, room.y + y, w, h, color, 0x5c4632);
      const bed = (x, y) => { f(x, y, 1.5, 0.8, 0xe7ecef); f(x, y, 0.35, 0.8, 0x93b7d4); };
      const desk = (x, y, w = 2) => f(x, y, w, 0.65, 0xa77b47);
      if (key === "ed") { for (let i = 0; i < 4; i++) bed(1.1 + i * 2.4, 1.7); for (let i = 0; i < 3; i++) bed(1.1 + i * 2.4, 5.4); desk(8.8, 4.0, 1.8); }
      else if (key === "ward") { for (let row = 0; row < 4; row++) for (let i = 0; i < 10; i++) bed(1 + i * 3.4, 2 + row * 3.1); }
      else if (key === "icu" || key === "pacu") { bed(1, 1.4); bed(4, 1.4); bed(1, 4.2); bed(4, 4.2); }
      else if (key === "or") { f(3.4, 3.2, 4.0, 1.4, 0xdfe8ef); f(1.2, 5.2, 1.2, 1, 0x87a9b7); }
      else if (key === "lab") { desk(1, 2, 11); f(2, 5, 1.2, 1.2, 0xdfe8ef); f(6, 5, 1.2, 1.2, 0xdfe8ef); }
      else if (key === "imaging") { f(4, 2.4, 4.2, 3, 0xd9e4ea); f(5.3, 3.2, 1.8, 1.2, 0x91a4b1); }
      else if (key === "triage" || key === "admission" || key === "discharge" || key === "pharmacy" || key === "consults") { desk(1, 2, Math.max(2, room.w - 3)); }
      else if (key === "elevator") { f(0.8, 0.8, 1.0, 2.5, 0x8aa0aa); f(2.2, 0.8, 1.0, 2.5, 0x8aa0aa); }
    }
    drawHeat(counts) {
      const floorRooms = layouts[String(selectedFloor)] || {};
      for (const [key, room] of Object.entries(floorRooms)) {
        const pressure = Math.min(1, (counts[key] || 0) / (capacities[key] || 1));
        if (pressure < 0.18) continue;
        this.rect(this.map, room.x, room.y, room.w, room.h, 0xd62828, null, 0.1 + pressure * 0.42);
      }
    }
    drawArchitect(counts) {
      this.drawHeat(counts);
      this.routeLayer.lineStyle(Math.max(2, this.tile * 0.12), 0x1d4ed8, 0.45);
      for (const patient of patients.slice(0, 120)) {
        for (let i = 0; i < patient.route.length - 1; i++) {
          const a = patient.route[i], b = patient.route[i + 1];
          if (a.floor === selectedFloor) this.drawPath(pathBetween(a.room, a.floor === b.floor ? b.room : "elevator", selectedFloor), this.routeLayer);
          if (b.floor === selectedFloor && a.floor !== b.floor) this.drawPath(pathBetween("elevator", b.room, selectedFloor), this.routeLayer);
        }
      }
    }
    drawPath(points, graphics) {
      if (!points.length) return;
      const first = this.px(points[0]);
      graphics.beginPath();
      graphics.moveTo(first.x, first.y);
      for (const p of points.slice(1)) {
        const q = this.px(p);
        graphics.lineTo(q.x, q.y);
      }
      graphics.strokePath();
    }
    drawStaff() {
      for (const s of staff[String(selectedFloor)] || []) {
        this.drawHuman({ x: s[1], y: s[2] }, { body: s[3] === "doctor" ? 0xf6f7f8 : s[3] === "admin" ? 0x7c6bb0 : s[3] === "pharm" ? 0x8fcf82 : 0x4f83cc, trim: 0x315043, staff: true, scale: 0.92 });
      }
    }
    drawActors(active) {
      const sorted = [...active].sort((a, b) => a[1].y - b[1].y);
      for (const [patient, pos] of sorted) {
        this.drawHuman(pos, {
          body: severityColor[patient.severity] || 0x2a9d8f,
          trim: pos.moving ? 0x2f5f9f : (streamTrim[patient.stream] || 0x293241),
          staff: false,
          scale: pos.moving ? 0.98 : 0.9,
        });
      }
    }
    drawHuman(point, options) {
      const p = this.px(point);
      const s = this.tile * (options.scale || 1);
      this.actorLayer.fillStyle(0x1f2933, 0.22);
      this.actorLayer.fillRect(p.x - s * 0.28, p.y + s * 0.22, s * 0.56, s * 0.16);
      this.actorLayer.fillStyle(options.trim, 1);
      this.actorLayer.fillRect(p.x - s * 0.22, p.y + s * 0.18, s * 0.16, s * 0.32);
      this.actorLayer.fillRect(p.x + s * 0.06, p.y + s * 0.18, s * 0.16, s * 0.32);
      this.actorLayer.fillStyle(options.body, 1);
      this.actorLayer.fillRect(p.x - s * 0.28, p.y - s * 0.24, s * 0.56, s * 0.5);
      this.actorLayer.fillStyle(0xd8a878, 1);
      this.actorLayer.fillRect(p.x - s * 0.21, p.y - s * 0.64, s * 0.42, s * 0.36);
      this.actorLayer.fillStyle(0x2b2d42, 1);
      this.actorLayer.fillRect(p.x - s * 0.24, p.y - s * 0.72, s * 0.48, s * 0.16);
      if (options.staff) {
        this.actorLayer.fillStyle(0xd62828, 1);
        this.actorLayer.fillRect(p.x - s * 0.04, p.y - s * 0.18, s * 0.08, s * 0.2);
        this.actorLayer.fillRect(p.x - s * 0.1, p.y - s * 0.12, s * 0.2, s * 0.08);
      }
    }
  }

  const config = {
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#78d957",
    scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
    render: { pixelArt: true, antialias: false },
    scene: HospitalScene,
  };
  new Phaser.Game(config);
}

playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.textContent = playing ? "||" : ">";
});
resetButton.addEventListener("click", () => {
  currentTime = payload.warmup || 0;
  playing = true;
  playButton.textContent = "||";
});
timeSlider.addEventListener("input", () => {
  currentTime = Number(timeSlider.value);
  playing = false;
  playButton.textContent = ">";
});
floorSelect.addEventListener("change", () => { selectedFloor = Number(floorSelect.value); });
viewModeSelect.addEventListener("change", () => { viewMode = viewModeSelect.value; });
</script>
</body>
</html>
"""
