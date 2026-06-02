from __future__ import annotations

from collections import defaultdict
from dataclasses import replace
from typing import Iterable

from hospital_sim.architecture import architecture_metrics
from hospital_sim.config import CapacityConfig, HospitalConfig, ResourceLocation
from hospital_sim.engine import ResourceStats, SimulationResult, patient_records

from .contracts import (
    CapacityPayload,
    HospitalPlanPayload,
    PlacedRoomPayload,
    ResourceStatPayload,
    SimulationScenarioPayload,
    SimulationSummary,
)


SIMULATION_NODE_TO_RESOURCES: dict[str, tuple[str, ...]] = {
    "arrival_public": (),
    "arrival_ambulance": (),
    "triage": ("triage",),
    "registration": ("registration",),
    "ed_bay": ("ed_bay", "ed_physician"),
    "resus": ("ed_bay", "ed_physician"),
    "observation": ("ed_bay",),
    "consult": ("outpatient_clinician",),
    "imaging": ("imaging",),
    "lab": ("lab",),
    "or": ("operating_room",),
    "hybrid_or": ("operating_room",),
    "pacu": ("pacu",),
    "icu": ("icu_bed",),
    "ward": ("ward_bed",),
    "maternity": ("ward_bed",),
    "neonatal_icu": ("icu_bed",),
    "pharmacy": ("pharmacy",),
    "discharge": ("discharge",),
    "logistics": ("transport",),
    "vertical_core": ("elevator",),
    "emergency_stair": (),
    "refuge_area": (),
    "fire_sector": (),
    "exit": (),
    "ed_physician": ("ed_physician",),
    "outpatient_clinician": ("outpatient_clinician",),
    "operating_room": ("operating_room",),
    "ward_bed": ("ward_bed",),
    "icu_bed": ("icu_bed",),
    "transport": ("transport",),
    "elevator": ("elevator",),
}

RESOURCE_TO_FRONTEND_NODE = {
    "triage": "triage",
    "registration": "registration",
    "ed_bay": "ed_bay",
    "ed_physician": "ed_bay",
    "outpatient_clinician": "consult",
    "lab": "lab",
    "imaging": "imaging",
    "pharmacy": "pharmacy",
    "operating_room": "or",
    "pacu": "pacu",
    "ward_bed": "ward",
    "icu_bed": "icu",
    "discharge": "discharge",
    "transport": "logistics",
    "elevator": "vertical_core",
}

PLAN_CAPACITY_FIELDS = {
    "ed_bay": "ed_bays",
    "outpatient_clinician": "outpatient_clinicians",
    "lab": "lab_slots",
    "imaging": "imaging_rooms",
    "pharmacy": "pharmacy_windows",
    "operating_room": "operating_rooms",
    "pacu": "pacu_beds",
    "ward_bed": "ward_beds",
    "icu_bed": "icu_beds",
    "elevator": "elevators",
}

REQUIRED_SIMULATION_RESOURCES = {
    "registration",
    "triage",
    "ed_bay",
    "lab",
    "imaging",
    "operating_room",
    "pacu",
    "ward_bed",
    "icu_bed",
}


def capacity_payload_to_config(payload: CapacityPayload | None) -> CapacityConfig:
    if payload is None:
        return CapacityConfig()
    return CapacityConfig(**payload.model_dump())


def resource_locations_from_plan(plan: HospitalPlanPayload) -> tuple[ResourceLocation, ...]:
    locations: dict[str, ResourceLocation] = {}
    for room in plan.rooms:
        resources = resources_for_room(room)
        if not resources:
            continue
        center_x = room.x + room.w / 2
        center_y = room.y + room.h / 2
        for resource in resources:
            locations.setdefault(resource, ResourceLocation(resource, room.floor, center_x, center_y))
    return tuple(sorted(locations.values(), key=lambda item: item.resource))


def architecture_blocks_from_plan(plan: HospitalPlanPayload) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for room in plan.rooms:
        resources = resources_for_room(room)
        blocks.append(
            {
                "id": room.id,
                "name": room.name,
                "kind": room.kind,
                "floor": str(room.floor),
                "node": ",".join(resources),
                "x": room.x,
                "y": room.y,
                "w": room.w,
                "h": room.h,
            }
        )
    return blocks


def architecture_metrics_from_plan(plan: HospitalPlanPayload) -> dict[str, float | str]:
    return architecture_metrics(architecture_blocks_from_plan(plan))


def hospital_config_from_plan(
    plan: HospitalPlanPayload,
    scenario: SimulationScenarioPayload,
) -> HospitalConfig:
    explicit_capacities = scenario.capacities is not None
    capacities = capacity_payload_to_config(scenario.capacities)
    if not explicit_capacities:
        capacities = infer_capacities_from_plan(plan, capacities)
    metrics = architecture_metrics_from_plan(plan)
    return HospitalConfig(
        days=scenario.days,
        warmup_days=scenario.warmup_days,
        seed=scenario.seed,
        arrival_scale=scenario.arrival_scale,
        ed_scale=scenario.ed_scale,
        outpatient_scale=scenario.outpatient_scale,
        elective_surgery_scale=scenario.elective_surgery_scale,
        early_discharge=scenario.early_discharge,
        surge_protocol=scenario.surge_protocol,
        dynamic_bed_pool=scenario.dynamic_bed_pool,
        capacities=capacities,
        architecture_name=plan.name,
        resource_locations=resource_locations_from_plan(plan),
        horizontal_travel_factor=float(metrics.get("horizontal_factor", 1.0)),
        vertical_travel_factor=float(metrics.get("vertical_factor", 1.0)),
    )


def infer_capacities_from_plan(plan: HospitalPlanPayload, fallback: CapacityConfig) -> CapacityConfig:
    totals: dict[str, int] = defaultdict(int)
    for room in plan.rooms:
        for resource in resources_for_room(room):
            capacity_field = PLAN_CAPACITY_FIELDS.get(resource)
            if capacity_field and room.capacity > 0:
                totals[capacity_field] += room.capacity
    overrides = {field: max(1, value) for field, value in totals.items() if value > 0}
    return replace(fallback, **overrides) if overrides else fallback


def resources_for_room(room: PlacedRoomPayload) -> tuple[str, ...]:
    if room.simulation_node:
        resources = _resources_from_node(room.simulation_node)
        if resources:
            return resources
    return _infer_resources_from_room(room)


def frontend_node_for_resources(resources: Iterable[str]) -> str | None:
    for resource in resources:
        node = RESOURCE_TO_FRONTEND_NODE.get(resource)
        if node:
            return node
    return None


def rule_warnings_for_plan(plan: HospitalPlanPayload) -> list[dict[str, str]]:
    locations = {location.resource for location in resource_locations_from_plan(plan)}
    missing = sorted(REQUIRED_SIMULATION_RESOURCES - locations)
    warnings: list[dict[str, str]] = []
    if missing:
        warnings.append(
            {
                "severity": "warning",
                "code": "missing_simulation_nodes",
                "message": "Missing simulation nodes: " + ", ".join(missing),
            }
        )
    if "elevator" not in locations and any(room.floor != 0 for room in plan.rooms):
        warnings.append(
            {
                "severity": "warning",
                "code": "missing_vertical_core",
                "message": "Multi-floor plans should declare at least one vertical_core/elevator node.",
            }
        )
    metrics = architecture_metrics_from_plan(plan)
    if float(metrics.get("covered_pairs", 0)) < 5:
        warnings.append(
            {
                "severity": "info",
                "code": "low_metric_coverage",
                "message": "Few critical adjacency pairs are represented in the plan.",
            }
        )
    return warnings


def simulation_summary_from_result(result: SimulationResult, patient_limit: int = 25) -> SimulationSummary:
    return SimulationSummary(
        kpis={key: float(value) for key, value in result.kpis.items()},
        resource_stats=[resource_stat_payload(stat) for stat in result.resource_stats],
        bottlenecks=result.bottlenecks,
        patients=patient_records(result.patients)[:patient_limit],
    )


def resource_stat_payload(stat: ResourceStats) -> ResourceStatPayload:
    return ResourceStatPayload(
        resource=stat.resource,
        capacity=stat.capacity,
        utilization=stat.utilization,
        wait_mean=stat.wait_mean,
        wait_p90=stat.wait_p90,
        wait_max=stat.wait_max,
        max_queue=stat.max_queue,
        busy_hours=stat.busy_hours,
    )


def _resources_from_node(node: str) -> tuple[str, ...]:
    normalised = node.strip()
    if "," in normalised:
        resources: list[str] = []
        for item in normalised.split(","):
            resources.extend(_resources_from_node(item))
        return tuple(dict.fromkeys(resources))
    return SIMULATION_NODE_TO_RESOURCES.get(normalised, ())


def _infer_resources_from_room(room: PlacedRoomPayload) -> tuple[str, ...]:
    name = room.name.lower()
    kind = room.kind.lower()
    if "triage" in name or "triaje" in name:
        return ("triage",)
    if "admision" in name or "admission" in name or "hall" in name:
        return ("registration",)
    if "urgencia" in name or "ed" in name or kind == "emergency":
        return ("ed_bay", "ed_physician")
    if "consulta" in name or kind == "ambulatory":
        return ("outpatient_clinician",)
    if "imagen" in name or "imaging" in name or kind == "diagnostic":
        return ("imaging",)
    if "lab" in name or "laboratorio" in name or kind == "laboratory":
        return ("lab",)
    if "quirofano" in name or "operating" in name or kind == "surgery":
        return ("operating_room",)
    if "pacu" in name or "reanimacion" in name:
        return ("pacu",)
    if "uci" in name or "icu" in name or kind == "critical":
        return ("icu_bed",)
    if "hospitalizacion" in name or "ward" in name or kind == "inpatient":
        return ("ward_bed",)
    if "farmacia" in name or "pharmacy" in name:
        return ("pharmacy",)
    if "alta" in name or "discharge" in name:
        return ("discharge",)
    if "ascensor" in name or "vertical" in name or kind == "vertical":
        return ("elevator",)
    if "logistica" in name or "logistics" in name or kind == "logistics":
        return ("transport",)
    return ()
