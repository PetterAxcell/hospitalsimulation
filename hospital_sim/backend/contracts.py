from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


def to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.title() for part in parts[1:])


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class CapacityPayload(APIModel):
    triage_nurses: int = Field(default=3, ge=1)
    registration_clerks: int = Field(default=4, ge=1)
    ed_bays: int = Field(default=28, ge=1)
    ed_physicians: int = Field(default=7, ge=1)
    outpatient_clinicians: int = Field(default=10, ge=1)
    lab_slots: int = Field(default=6, ge=1)
    imaging_rooms: int = Field(default=3, ge=1)
    pharmacy_windows: int = Field(default=3, ge=1)
    operating_rooms: int = Field(default=5, ge=1)
    pacu_beds: int = Field(default=10, ge=1)
    ward_beds: int = Field(default=150, ge=1)
    icu_beds: int = Field(default=18, ge=1)
    discharge_coordinators: int = Field(default=4, ge=1)
    transporters: int = Field(default=4, ge=1)
    elevators: int = Field(default=3, ge=1)


class PlacedRoomPayload(APIModel):
    id: str = Field(min_length=1)
    template_id: str | None = None
    name: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    floor: int
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    capacity: int = Field(default=1, ge=0)
    area_sqm: float = Field(default=0, ge=0)
    equipment: list[str] = Field(default_factory=list)
    staff_model: list[str] = Field(default_factory=list)
    simulation_node: str | None = None
    locked: bool = False


class HospitalPlanPayload(APIModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    target_area_sqm: float = Field(gt=0)
    site_area_sqm: float = Field(default=0, ge=0)
    floors: list[int] = Field(min_length=1)
    rooms: list[PlacedRoomPayload] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_room_floors(self) -> "HospitalPlanPayload":
        known_floors = set(self.floors)
        missing = sorted({room.floor for room in self.rooms if room.floor not in known_floors})
        if missing:
            raise ValueError(f"room floors not declared in plan: {missing}")
        return self


class ProjectCreateRequest(APIModel):
    name: str = Field(min_length=1)
    target_area_sqm: float = Field(default=290_000, gt=0)
    site_area_sqm: float = Field(default=210_000, ge=0)


class ProjectResponse(APIModel):
    id: str
    name: str
    target_area_sqm: float
    site_area_sqm: float
    status: str = "active"
    created_at: datetime


class PlanVersionResponse(APIModel):
    id: str
    project_id: str
    version: int
    plan: HospitalPlanPayload
    created_at: datetime


class SimulationScenarioPayload(APIModel):
    days: int = Field(default=14, ge=1, le=365)
    warmup_days: int = Field(default=2, ge=0, le=120)
    seed: int = Field(default=42, ge=1)
    arrival_scale: float = Field(default=1.0, ge=0, le=10)
    ed_scale: float = Field(default=1.0, ge=0, le=10)
    outpatient_scale: float = Field(default=1.0, ge=0, le=10)
    elective_surgery_scale: float = Field(default=1.0, ge=0, le=10)
    early_discharge: bool = False
    surge_protocol: bool = False
    dynamic_bed_pool: bool = False
    capacities: CapacityPayload | None = None

    @model_validator(mode="after")
    def validate_warmup(self) -> "SimulationScenarioPayload":
        if self.warmup_days >= self.days:
            raise ValueError("warmup_days must be lower than days")
        return self


class SimulationRunRequest(APIModel):
    scenario: SimulationScenarioPayload = Field(default_factory=SimulationScenarioPayload)
    include_patients: int = Field(default=25, ge=0, le=500)


class ResourceDefinition(APIModel):
    resource: str
    label: str
    default_floor: int
    capacity_field: str | None = None


class CatalogResponse(APIModel):
    resources: list[ResourceDefinition]
    simulation_node_mapping: dict[str, list[str]]


class ResourceStatPayload(APIModel):
    resource: str
    capacity: int
    utilization: float
    wait_mean: float
    wait_p90: float
    wait_max: float
    max_queue: int
    busy_hours: float


class SimulationSummary(APIModel):
    kpis: dict[str, float]
    resource_stats: list[ResourceStatPayload]
    bottlenecks: list[dict[str, Any]]
    patients: list[dict[str, Any]] = Field(default_factory=list)


class SimulationRunResponse(APIModel):
    run_id: str
    plan_id: str
    status: str
    scenario: SimulationScenarioPayload
    summary: SimulationSummary | None = None
    engine_version: str
    created_at: datetime
    completed_at: datetime | None = None


class RuleEvaluationResponse(APIModel):
    plan_id: str
    metrics: dict[str, float | str]
    warnings: list[dict[str, str]] = Field(default_factory=list)
