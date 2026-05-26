from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Mapping


DEFAULT_ED_PROFILE = (
    2.2,
    1.8,
    1.5,
    1.4,
    1.6,
    2.0,
    3.0,
    4.2,
    5.2,
    6.0,
    6.5,
    6.8,
    6.6,
    6.4,
    6.1,
    5.8,
    5.6,
    5.2,
    4.8,
    4.2,
    3.6,
    3.0,
    2.7,
    2.4,
)

DEFAULT_OUTPATIENT_PROFILE = (
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.4,
    4.0,
    9.0,
    13.0,
    14.0,
    13.0,
    9.0,
    10.0,
    12.0,
    11.0,
    8.0,
    4.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
)

DEFAULT_ELECTIVE_PROFILE = (
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.2,
    1.4,
    2.8,
    3.2,
    2.6,
    1.6,
    0.8,
    0.4,
    0.1,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
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
