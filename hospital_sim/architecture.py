from __future__ import annotations

import math
import re
from typing import Any

from .config import ResourceLocation


DEFAULT_RESOURCE_FLOORS = {
    "triage": 0,
    "registration": 0,
    "ed_bay": 0,
    "ed_physician": 0,
    "outpatient_clinician": 0,
    "lab": -1,
    "imaging": -1,
    "pharmacy": 0,
    "operating_room": 1,
    "pacu": 1,
    "ward_bed": 2,
    "icu_bed": 1,
    "discharge": 0,
    "transport": 0,
    "elevator": 0,
}

GAME_ROOM_BY_RESOURCE = {
    "triage": "triage",
    "registration": "admission",
    "ed_bay": "ed",
    "ed_physician": "ed",
    "outpatient_clinician": "consults",
    "lab": "lab",
    "imaging": "imaging",
    "pharmacy": "pharmacy",
    "operating_room": "or",
    "pacu": "pacu",
    "ward_bed": "ward",
    "icu_bed": "icu",
    "discharge": "discharge",
    "elevator": "elevator",
}


def block_floors(block: dict[str, Any]) -> tuple[int, ...]:
    value = str(block.get("floor", "0")).strip().lower()
    if value in {"shell", "abierto", "cubierta"}:
        return (0,)
    range_match = re.fullmatch(r"\s*(-?\d+)\s*-\s*(-?\d+)\s*", value)
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        step = 1 if end >= start else -1
        return tuple(range(start, end + step, step))
    numbers = [int(item) for item in re.findall(r"-?\d+", value)]
    return tuple(dict.fromkeys(numbers)) if numbers else (0,)


def infer_resource_nodes(block: dict[str, Any]) -> str:
    name = str(block.get("name", "")).lower()
    kind = str(block.get("kind", "")).lower()
    if "triage" in name or "triaje" in name:
        return "triage"
    if "hall" in name or "atrio" in name or "admision" in name or kind == "public":
        return "registration"
    if "espera" in name or "plaza" in name or "boulevard" in name or "family" in name:
        return ""
    if "urgencias" in name or "ed " in name or "ed adulto" in name or kind in {"emergency", "ambulance"}:
        return "triage,ed_bay,ed_physician"
    if "consulta" in name or "hospital de dia" in name or kind == "ambulatory":
        return "outpatient_clinician"
    if "imagen" in name and "lab" in name:
        return "lab,imaging"
    if "imagen" in name or "diagnostico" in name:
        return "imaging"
    if "lab" in name or "laboratorio" in name:
        return "lab"
    if "quirofano" in name and "pacu" in name:
        return "operating_room,pacu"
    if "quirofano" in name or kind == "surgery":
        return "operating_room"
    if "pacu" in name or "reanimacion" in name:
        return "pacu"
    if "uci" in name or "critico" in name or kind == "critical":
        return "icu_bed"
    if "hospitalizacion" in name or "ward" in name or kind == "inpatient":
        return "ward_bed"
    if "farmacia" in name:
        return "pharmacy"
    if "alta" in name:
        return "discharge"
    if "ascensor" in name or "nucleo" in name:
        return "elevator"
    if "logistica" in name or "cssd" in name or "mep" in name:
        return "transport"
    return ""


def prepare_architecture_blocks(option: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, block in enumerate(option["blocks"], start=1):
        row = dict(block)
        row["id"] = row.get("id") or f"b{index:02d}"
        row["node"] = row.get("node") or infer_resource_nodes(row)
        row["x"] = float(row.get("x", 0))
        row["y"] = float(row.get("y", 0))
        row["w"] = float(row.get("w", 10))
        row["h"] = float(row.get("h", 8))
        row["floor"] = str(row.get("floor", "0"))
        row["kind"] = str(row.get("kind", "public"))
        row["name"] = str(row.get("name", row["id"]))
        row["notes"] = str(row.get("notes", ""))
        rows.append(row)
    return rows


def resource_locations_from_blocks(blocks: list[dict[str, Any]]) -> tuple[ResourceLocation, ...]:
    locations: dict[str, ResourceLocation] = {}
    for block in blocks:
        nodes = [item.strip() for item in str(block.get("node", "")).split(",") if item.strip()]
        if not nodes:
            continue
        floors = block_floors(block)
        center_x = float(block.get("x", 0)) + float(block.get("w", 0)) / 2
        center_y = float(block.get("y", 0)) + float(block.get("h", 0)) / 2
        for node in nodes:
            preferred_floor = DEFAULT_RESOURCE_FLOORS.get(node, floors[0])
            floor = preferred_floor if preferred_floor in floors else floors[0]
            locations.setdefault(node, ResourceLocation(node, floor, center_x, center_y))
    return tuple(sorted(locations.values(), key=lambda item: item.resource))


def architecture_metrics(blocks: list[dict[str, Any]]) -> dict[str, float | str]:
    locations = {item.resource: item for item in resource_locations_from_blocks(blocks)}
    pairs = (
        ("ed_bay", "imaging", 1.4),
        ("ed_bay", "lab", 1.1),
        ("ed_bay", "operating_room", 1.6),
        ("ed_bay", "icu_bed", 1.5),
        ("operating_room", "pacu", 1.8),
        ("pacu", "icu_bed", 1.2),
        ("pacu", "ward_bed", 1.0),
        ("registration", "outpatient_clinician", 0.8),
    )
    weighted_distance = 0.0
    vertical_steps = 0
    covered_pairs = 0
    for origin, target, weight in pairs:
        a = locations.get(origin)
        b = locations.get(target)
        if not a or not b:
            continue
        covered_pairs += 1
        distance = math.hypot(a.x - b.x, a.y - b.y)
        weighted_distance += distance * weight
        vertical_steps += abs(a.floor - b.floor)
    baseline = 185.0
    horizontal_factor = min(1.85, max(0.72, weighted_distance / baseline)) if covered_pairs else 1.0
    vertical_factor = min(1.75, max(0.8, 0.9 + vertical_steps * 0.055))
    return {
        "hot_path_distance": round(weighted_distance, 1),
        "vertical_steps": float(vertical_steps),
        "covered_pairs": float(covered_pairs),
        "horizontal_factor": round(horizontal_factor, 3),
        "vertical_factor": round(vertical_factor, 3),
        "interpretation": _interpret(horizontal_factor, vertical_factor, covered_pairs),
    }


def game_layouts_from_blocks(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    layouts: dict[str, dict[str, dict[str, Any]]] = {}
    seen_rooms: set[tuple[str, str]] = set()
    for block in blocks:
        floors = block_floors(block)
        nodes = [item.strip() for item in str(block.get("node", "")).split(",") if item.strip()]
        game_rooms = [GAME_ROOM_BY_RESOURCE.get(node) for node in nodes if GAME_ROOM_BY_RESOURCE.get(node)]
        if not game_rooms and block.get("kind") in {"public", "waiting"}:
            game_rooms = ["entrance" if "plaza" in str(block.get("name", "")).lower() else "admission"]
        if not game_rooms:
            continue
        for floor in floors:
            floor_key = str(floor)
            layouts.setdefault(floor_key, {})
            for room in game_rooms:
                identity = (floor_key, room)
                if identity in seen_rooms:
                    continue
                seen_rooms.add(identity)
                layouts[floor_key][room] = {
                    "x": max(0.5, float(block.get("x", 0)) * 0.5),
                    "y": max(0.5, float(block.get("y", 0)) * 0.42),
                    "w": max(3.0, float(block.get("w", 8)) * 0.5),
                    "h": max(3.0, float(block.get("h", 7)) * 0.42),
                }
    for floor in list(layouts):
        layouts[floor]["elevator"] = {"x": 24, "y": 13, "w": 4, "h": 4}
    return layouts


def _interpret(horizontal_factor: float, vertical_factor: float, covered_pairs: int) -> str:
    if covered_pairs < 5:
        return "Faltan nodos simulables en el plano; la simulacion usa varios valores por defecto."
    if horizontal_factor <= 0.9 and vertical_factor <= 1.05:
        return "Arquitectura compacta para los recorridos criticos."
    if horizontal_factor >= 1.25 and vertical_factor >= 1.18:
        return "Riesgo alto: recorridos largos y demasiados saltos verticales."
    if horizontal_factor >= 1.25:
        return "Riesgo principal: distancia horizontal entre nodos criticos."
    if vertical_factor >= 1.18:
        return "Riesgo principal: dependencia de ascensores y cambios de planta."
    return "Arquitectura razonable, con margen para optimizar adyacencias."
