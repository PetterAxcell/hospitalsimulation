from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Mapping


DEFAULT_ED_PROFILE = (
    2.2, 1.8, 1.5, 1.4, 1.6, 2.0, 3.0, 4.2, 5.2, 6.0,
    6.5, 6.8, 6.6, 6.4, 6.1, 5.8, 5.6, 5.2, 4.8, 4.2,
    3.6, 3.0, 2.7, 2.4,
)

DEFAULT_OUTPATIENT_PROFILE = (
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.4, 4.0, 9.0, 13.0,
    14.0, 13.0, 9.0, 10.0, 12.0, 11.0, 8.0, 4.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 0.0,
)

DEFAULT_ELECTIVE_PROFILE = (
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 1.4, 2.8, 3.2,
    2.6, 1.6, 0.8, 0.4, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0,
)


@dataclass(frozen=True)
class CapacityConfig:
    triage_nurses: int = 3
    registration_clerks: int = 4
    ed_bays: int = 28
    ed_physicians: int = 7
    outpatient_clinicians: int = 10
    lab_slots: int = 6
    imaging_rooms: int = 3
    pharmacy_windows: int = 3
    operating_rooms: int = 5
    pacu_beds: int = 10
    ward_beds: int = 150
    icu_beds: int = 18
    discharge_coordinators: int = 4
    transporters: int = 4
    elevators: int = 3

    def with_overrides(self, overrides: Mapping[str, int]) -> "CapacityConfig":
        values = {k: max(1, int(v)) for k, v in overrides.items() if hasattr(self, k)}
        return replace(self, **values)


@dataclass(frozen=True)
class ResourceLocation:
    resource: str
    floor: int
    x: float
    y: float


@dataclass(frozen=True)
class SpecialistConfig:
    type: str
    is_surgical: bool = False
    base_proportion: float = 0.05  # 1/20 by default


@dataclass(frozen=True)
class StaffProportions:
    specialist: float = 0.20
    nurse: float = 0.40
    technician: float = 0.30
    security: float = 0.05
    emergency_team: float = 0.05


@dataclass(frozen=True)
class ResourceConfig:
    id: str
    name: str
    base_capacity: int = 10
    staff_required: int = 2
    required_specialist_types: tuple[str, ...] = ()
    floor: int = 0
    room_kind: str = "public"
    time_multiplier: float = 1.0


@dataclass(frozen=True)
class ChannelConfig:
    id: str
    from_room_id: str
    to_room_id: str
    base_travel_time: float = 3.0
    congestion_slope: float = 0.8
    max_concurrent: int = 15
    is_bidirectional: bool = True
    is_visible: bool = True


@dataclass(frozen=True)
class DisruptorTemplate:
    id: str
    name: str
    description: str = ""
    icon: str = "🚨"
    severity: str = "medium"
    probability: float = 0.05
    required_roles: tuple[str, ...] = ()
    required_specialties: tuple[str, ...] = ()
    requires_security: bool = False
    requires_emergency_team: bool = False
    resolution_time: float = 30.0
    escalation_time: float = 15.0
    can_propagate: bool = False
    propagation_radius: int = 0
    blocks_room: bool = True
    effects: tuple[str, ...] = ()


@dataclass
class DisruptorEvent:
    id: str
    template_id: str
    room_id: str
    start_time: float
    state: str = "created"  # created | active | in_progress | resolved | escalated
    assigned_agents: list[str] = field(default_factory=list)
    resolution_start_time: float | None = None
    resolution_end_time: float | None = None
    escalated_at: float | None = None
    response_time: float | None = None


@dataclass
class EventResolutionMetrics:
    disruptor_type: str = ""
    total: int = 0
    resolved: int = 0
    escalated: int = 0
    avg_resolution_time: float = 0.0
    max_resolution_time: float = 0.0
    avg_response_time: float = 0.0
    propagation_events: int = 0
    rooms_blocked: int = 0
    patients_affected: int = 0


@dataclass(frozen=True)
class HospitalConfig:
    days: int = 14
    warmup_days: int = 2
    seed: int = 42
    arrival_scale: float = 1.0
    ed_scale: float = 1.0
    outpatient_scale: float = 1.0
    elective_surgery_scale: float = 1.0
    early_discharge: bool = False
    surge_protocol: bool = False
    dynamic_bed_pool: bool = False
    capacities: CapacityConfig = field(default_factory=CapacityConfig)
    architecture_name: str = "Base"
    resource_locations: tuple[ResourceLocation, ...] = ()
    horizontal_travel_factor: float = 1.0
    vertical_travel_factor: float = 1.0
    ed_hourly_profile: tuple[float, ...] = DEFAULT_ED_PROFILE
    outpatient_hourly_profile: tuple[float, ...] = DEFAULT_OUTPATIENT_PROFILE
    elective_hourly_profile: tuple[float, ...] = DEFAULT_ELECTIVE_PROFILE
    # New fields
    total_patients: int | None = None
    staff_proportions: StaffProportions = field(default_factory=StaffProportions)
    specialist_configs: tuple[SpecialistConfig, ...] = ()
    emergency_team_ratio: int = 200
    room_time_multipliers: dict[str, float] = field(default_factory=lambda: {
        "emergency": 1.0, "diagnostic": 1.1, "surgery": 1.3, "critical": 1.2,
        "inpatient": 1.0, "ambulatory": 1.0, "maternalChild": 1.1, "oncology": 1.0,
        "pharmacy": 1.0, "laboratory": 1.0, "logistics": 1.0, "research": 1.0,
        "public": 1.0, "waiting": 1.0, "staff": 1.0, "technical": 1.0,
        "vertical": 1.0, "green": 1.0, "future": 1.0,
    })
    disruptor_templates: tuple[DisruptorTemplate, ...] = ()
    disruptor_probability: float = 0.03
    disruptor_events_per_hour: float = 0.5
    channel_configs: tuple[ChannelConfig, ...] = ()
    resource_configs: tuple[ResourceConfig, ...] =()

    @property
    def duration_minutes(self) -> int:
        return int(self.days * 24 * 60)

    @property
    def warmup_minutes(self) -> int:
        return int(self.warmup_days * 24 * 60)

    def resolved_capacities(self) -> CapacityConfig:
        caps = self.capacities
        if self.surge_protocol:
            caps = replace(
                caps,
                triage_nurses=caps.triage_nurses + 1,
                ed_physicians=caps.ed_physicians + 1,
                ed_bays=caps.ed_bays + 4,
                ward_beds=caps.ward_beds + 12,
                icu_beds=caps.icu_beds + 3,
                transporters=caps.transporters + 1,
                elevators=caps.elevators + 1,
            )
        if self.dynamic_bed_pool:
            convertible = max(1, round(caps.ward_beds * 0.04))
            caps = replace(caps, ward_beds=caps.ward_beds - convertible, icu_beds=caps.icu_beds + convertible)
        return caps

    def with_capacity(self, **overrides: int) -> "HospitalConfig":
        return replace(self, capacities=self.capacities.with_overrides(overrides))
