from __future__ import annotations

import math
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from statistics import mean
from typing import Any

import simpy

from .config import CapacityConfig, HospitalConfig, ResourceLocation


SEVERITY_PRIORITY = {"severe": 0, "moderate": 1, "mild": 2}
SEVERITY_MULTIPLIER = {"mild": 0.82, "moderate": 1.0, "severe": 1.35}
RESOURCE_FLOORS = {
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
}


@dataclass
class Patient:
    patient_id: int
    stream: str
    severity: str
    arrival_time: float
    stages: dict[str, float] = field(default_factory=dict)
    waits: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    admitted: bool = False
    destination: str = "home"
    boarding_wait: float = 0.0
    pacu_boarding_wait: float = 0.0
    or_block_wait: float = 0.0
    discharge_delay: float = 0.0
    elevator_wait: float = 0.0
    travel_time: float = 0.0
    horizontal_travel_time: float = 0.0
    vertical_travel_time: float = 0.0
    current_floor: int = 0
    current_resource: str = "entrance"
    completed: bool = False
    departure_time: float | None = None


@dataclass
class ResourceStats:
    resource: str
    capacity: int
    utilization: float
    wait_mean: float
    wait_p90: float
    wait_max: float
    max_queue: int
    busy_hours: float


@dataclass
class SimulationResult:
    config: HospitalConfig
    kpis: dict[str, float]
    resource_stats: list[ResourceStats]
    bottlenecks: list[dict[str, Any]]
    patients: list[Patient]


class ResourcePool:
    def __init__(self, env: simpy.Environment, name: str, capacity: int, analysis_start: float, analysis_end: float):
        self.env = env
        self.name = name
        self.capacity = max(1, int(capacity))
        self.analysis_start = analysis_start
        self.analysis_end = analysis_end
        self.resource = simpy.PriorityResource(env, capacity=self.capacity)
        self.wait_times: list[float] = []
        self.busy_time = 0.0
        self.active_starts: dict[simpy.events.Event, float] = {}
        self.max_queue = 0

    def acquire(self, priority: int = 1):
        request_started = self.env.now
        req = self.resource.request(priority=priority)
        self.max_queue = max(self.max_queue, len(self.resource.queue) + 1)
        yield req
        wait = self.env.now - request_started
        if request_started >= self.analysis_start:
            self.wait_times.append(wait)
        self.active_starts[req] = self.env.now
        return req, wait

    def release(self, req: simpy.events.Event, start: float, end: float) -> None:
        active_start = self.active_starts.pop(req, start)
        overlap = max(0.0, min(end, self.analysis_end) - max(active_start, self.analysis_start))
        self.busy_time += overlap
        self.resource.release(req)

    def stats(self) -> ResourceStats:
        for active_start in self.active_starts.values():
            overlap = max(0.0, self.analysis_end - max(active_start, self.analysis_start))
            self.busy_time += overlap
        self.active_starts.clear()
        denominator = max(1.0, (self.analysis_end - self.analysis_start) * self.capacity)
        waits = self.wait_times
        return ResourceStats(
            resource=self.name,
            capacity=self.capacity,
            utilization=min(1.0, self.busy_time / denominator),
            wait_mean=_safe_mean(waits),
            wait_p90=_percentile(waits, 90),
            wait_max=max(waits) if waits else 0.0,
            max_queue=self.max_queue,
            busy_hours=self.busy_time / 60.0,
        )


class HospitalSimulation:
    def __init__(self, config: HospitalConfig):
        self.config = config
        self.env = simpy.Environment()
        self.rng = random.Random(config.seed)
        self.patient_seq = 0
        self.patients: list[Patient] = []
        self.resource_locations = {item.resource: item for item in config.resource_locations}
        caps = config.resolved_capacities()
        self.pools = self._build_pools(caps)

    def _build_pools(self, caps: CapacityConfig) -> dict[str, ResourcePool]:
        analysis_start = self.config.warmup_minutes
        analysis_end = self.config.duration_minutes
        capacities = {
            "triage": caps.triage_nurses,
            "registration": caps.registration_clerks,
            "ed_bay": caps.ed_bays,
            "ed_physician": caps.ed_physicians,
            "outpatient_clinician": caps.outpatient_clinicians,
            "lab": caps.lab_slots,
            "imaging": caps.imaging_rooms,
            "pharmacy": caps.pharmacy_windows,
            "operating_room": caps.operating_rooms,
            "pacu": caps.pacu_beds,
            "ward_bed": caps.ward_beds,
            "icu_bed": caps.icu_beds,
            "discharge": caps.discharge_coordinators,
            "transport": caps.transporters,
            "elevator": caps.elevators,
        }
        return {
            name: ResourcePool(self.env, name, capacity, analysis_start, analysis_end)
            for name, capacity in capacities.items()
        }

    def run(self) -> SimulationResult:
        self.env.process(self._arrival_stream("ed", self.config.ed_hourly_profile, self.config.ed_scale))
        self.env.process(
            self._arrival_stream("outpatient", self.config.outpatient_hourly_profile, self.config.outpatient_scale)
        )
        self.env.process(
            self._arrival_stream("elective", self.config.elective_hourly_profile, self.config.elective_surgery_scale)
        )
        self.env.run(until=self.config.duration_minutes)
        analysed_patients = [p for p in self.patients if p.arrival_time >= self.config.warmup_minutes]
        resource_stats = [pool.stats() for pool in self.pools.values()]
        kpis = self._kpis(analysed_patients, resource_stats)
        bottlenecks = detect_bottlenecks(kpis, resource_stats)
        return SimulationResult(
            config=self.config,
            kpis=kpis,
            resource_stats=resource_stats,
            bottlenecks=bottlenecks,
            patients=analysed_patients,
        )

    def _arrival_stream(self, stream: str, hourly_profile: tuple[float, ...], stream_scale: float):
        while self.env.now < self.config.duration_minutes:
            rate = self._current_hourly_rate(hourly_profile) * self.config.arrival_scale * stream_scale
            if rate <= 0:
                yield self.env.timeout(self._minutes_to_next_hour())
                continue
            interarrival = self.rng.expovariate(rate / 60.0)
            yield self.env.timeout(interarrival)
            if self.env.now >= self.config.duration_minutes:
                break
            patient = self._new_patient(stream)
            if stream == "ed":
                self.env.process(self._ed_pathway(patient))
            elif stream == "outpatient":
                self.env.process(self._outpatient_pathway(patient))
            else:
                self.env.process(self._elective_pathway(patient))

    def _current_hourly_rate(self, hourly_profile: tuple[float, ...]) -> float:
        hour = int((self.env.now // 60) % 24)
        weekday = int(self.env.now // (24 * 60)) % 7
        weekend_factor = 0.72 if weekday in (5, 6) else 1.0
        return hourly_profile[hour] * weekend_factor

    def _minutes_to_next_hour(self) -> float:
        return 60.0 - (self.env.now % 60.0)

    def _new_patient(self, stream: str) -> Patient:
        self.patient_seq += 1
        severity = self._sample_severity(stream)
        patient = Patient(self.patient_seq, stream, severity, self.env.now)
        patient.stages["arrival"] = self.env.now
        self.patients.append(patient)
        return patient

    def _sample_severity(self, stream: str) -> str:
        roll = self.rng.random()
        if stream == "ed":
            if roll < 0.18:
                return "severe"
            if roll < 0.58:
                return "moderate"
            return "mild"
        if stream == "elective":
            if roll < 0.08:
                return "severe"
            if roll < 0.45:
                return "moderate"
            return "mild"
        if roll < 0.05:
            return "severe"
        if roll < 0.30:
            return "moderate"
        return "mild"

    def _ed_pathway(self, patient: Patient):
        priority = SEVERITY_PRIORITY[patient.severity]
        yield from self._use(patient, "triage", self._duration("triage", patient), priority, "triage")
        yield from self._use(patient, "registration", self._duration("registration", patient), priority, "registration")

        ed_req, ed_wait = yield from self.pools["ed_bay"].acquire(priority)
        patient.waits["ed_bay"] += ed_wait
        patient.stages["ed_bay_start"] = self.env.now
        ed_bay_start = self.env.now

        yield from self._use(patient, "ed_physician", self._duration("ed_assessment", patient), priority, "ed_assessment")
        yield from self._diagnostics(patient, priority, ed_mode=True)
        yield from self._use(patient, "ed_physician", self._duration("reassessment", patient), priority, "ed_reassessment")

        if self._should_admit_from_ed(patient):
            patient.admitted = True
            destination = self._admission_destination(patient)
            patient.destination = destination
            bed_pool_name = "icu_bed" if destination == "icu" else "ward_bed"
            request_started = self.env.now
            bed_req, bed_wait = yield from self.pools[bed_pool_name].acquire(priority)
            patient.boarding_wait = self.env.now - request_started
            patient.waits[bed_pool_name] += bed_wait
            self.pools["ed_bay"].release(ed_req, ed_bay_start, self.env.now)
            patient.stages["ed_bay_end"] = self.env.now
            yield from self._move_to_resource(patient, bed_pool_name, priority, "admission_transport")
            yield from self._inpatient_stay(patient, bed_pool_name, bed_req, priority)
        else:
            yield from self._use(patient, "pharmacy", self._duration("pharmacy", patient), priority, "pharmacy")
            self.pools["ed_bay"].release(ed_req, ed_bay_start, self.env.now)
            patient.stages["ed_bay_end"] = self.env.now
            self._complete(patient)

    def _outpatient_pathway(self, patient: Patient):
        priority = SEVERITY_PRIORITY[patient.severity]
        yield from self._use(patient, "registration", self._duration("registration", patient), priority, "registration")
        yield from self._use(
            patient,
            "outpatient_clinician",
            self._duration("outpatient_consult", patient),
            priority,
            "consultation",
        )
        yield from self._diagnostics(patient, priority, ed_mode=False)
        if patient.severity == "severe" and self.rng.random() < 0.18:
            patient.admitted = True
            patient.destination = "ward"
            bed_req, bed_wait = yield from self.pools["ward_bed"].acquire(priority)
            patient.waits["ward_bed"] += bed_wait
            yield from self._move_to_resource(patient, "ward_bed", priority, "admission_transport")
            yield from self._inpatient_stay(patient, "ward_bed", bed_req, priority)
        else:
            yield from self._use(patient, "pharmacy", self._duration("pharmacy", patient), priority, "pharmacy")
            self._complete(patient)

    def _elective_pathway(self, patient: Patient):
        priority = SEVERITY_PRIORITY[patient.severity]
        yield from self._use(patient, "registration", self._duration("preop_registration", patient), priority, "preop")
        or_req, or_wait = yield from self.pools["operating_room"].acquire(priority)
        patient.waits["operating_room"] += or_wait
        patient.stages["or_start"] = self.env.now
        or_start = self.env.now
        yield self.env.timeout(self._duration("surgery", patient))

        pacu_request_started = self.env.now
        pacu_req, pacu_wait = yield from self.pools["pacu"].acquire(priority)
        patient.or_block_wait = self.env.now - pacu_request_started
        patient.waits["pacu"] += pacu_wait
        self.pools["operating_room"].release(or_req, or_start, self.env.now)
        patient.stages["or_end"] = self.env.now

        pacu_start = self.env.now
        patient.stages["pacu_start"] = self.env.now
        yield self.env.timeout(self._duration("pacu_recovery", patient))
        destination = "icu" if patient.severity == "severe" and self.rng.random() < 0.32 else "ward"
        patient.admitted = True
        patient.destination = destination
        bed_pool_name = "icu_bed" if destination == "icu" else "ward_bed"
        bed_request_started = self.env.now
        bed_req, bed_wait = yield from self.pools[bed_pool_name].acquire(priority)
        patient.pacu_boarding_wait = self.env.now - bed_request_started
        patient.waits[bed_pool_name] += bed_wait
        patient.stages["pacu_end"] = self.env.now
        self.pools["pacu"].release(pacu_req, pacu_start, self.env.now)
        yield from self._move_to_resource(patient, bed_pool_name, priority, "postop_transport")
        yield from self._inpatient_stay(patient, bed_pool_name, bed_req, priority)

    def _diagnostics(self, patient: Patient, priority: int, ed_mode: bool):
        lab_probability = {"mild": 0.35, "moderate": 0.68, "severe": 0.92}[patient.severity]
        imaging_probability = {"mild": 0.12, "moderate": 0.36, "severe": 0.72}[patient.severity]
        if not ed_mode:
            lab_probability *= 0.75
            imaging_probability *= 0.65
        if self.rng.random() < lab_probability:
            yield from self._use(patient, "lab", self._duration("lab", patient), priority, "lab")
        if self.rng.random() < imaging_probability:
            yield from self._use(patient, "imaging", self._duration("imaging", patient), priority, "imaging")

    def _inpatient_stay(self, patient: Patient, bed_pool_name: str, bed_req: simpy.events.Event, priority: int):
        bed_start = self.env.now
        patient.stages[f"{bed_pool_name}_start"] = self.env.now
        yield self.env.timeout(self._los(patient, bed_pool_name))
        discharge_delay = self._discharge_delay()
        patient.discharge_delay = discharge_delay
        yield self.env.timeout(discharge_delay)
        yield from self._use(patient, "discharge", self._duration("discharge", patient), priority, "discharge")
        self.pools[bed_pool_name].release(bed_req, bed_start, self.env.now)
        patient.stages[f"{bed_pool_name}_end"] = self.env.now
        self._complete(patient)

    def _complete(self, patient: Patient) -> None:
        patient.completed = True
        patient.departure_time = self.env.now
        patient.stages["departure"] = self.env.now

    def _should_admit_from_ed(self, patient: Patient) -> bool:
        probability = {"mild": 0.10, "moderate": 0.34, "severe": 0.72}[patient.severity]
        return self.rng.random() < probability

    def _admission_destination(self, patient: Patient) -> str:
        if patient.severity == "severe" and self.rng.random() < 0.38:
            return "icu"
        if patient.severity == "moderate" and self.rng.random() < 0.08:
            return "icu"
        return "ward"

    def _use(self, patient: Patient, resource_name: str, duration: float, priority: int, stage: str):
        yield from self._move_to_resource(patient, resource_name, priority, f"{stage}_move")
        pool = self.pools[resource_name]
        req, wait = yield from pool.acquire(priority)
        patient.waits[resource_name] += wait
        start = self.env.now
        patient.stages[f"{stage}_start"] = start
        yield self.env.timeout(duration)
        patient.stages[f"{stage}_end"] = self.env.now
        pool.release(req, start, self.env.now)

    def _move_to_resource(self, patient: Patient, resource_name: str, priority: int, stage: str):
        target_floor = self._resource_floor(resource_name)
        if target_floor is None:
            patient.current_resource = resource_name
            return
        horizontal_duration = self._horizontal_transport_duration(patient.current_resource, resource_name, patient.current_floor)
        if horizontal_duration > 0:
            patient.horizontal_travel_time += horizontal_duration
            patient.travel_time += horizontal_duration
            patient.stages[f"{stage}_horizontal_start"] = self.env.now
            yield self.env.timeout(horizontal_duration)
            patient.stages[f"{stage}_horizontal_end"] = self.env.now
        if target_floor == patient.current_floor:
            patient.current_resource = resource_name
            return
        floors = abs(target_floor - patient.current_floor)
        porter_duration = self._vertical_transport_duration("porter", floors)
        patient.vertical_travel_time += porter_duration
        patient.travel_time += porter_duration
        yield from self._use_local_resource(
            patient,
            "transport",
            porter_duration,
            priority,
            f"{stage}_porter",
        )
        patient.stages[f"{stage}_elevator_start"] = self.env.now
        pool = self.pools["elevator"]
        req, wait = yield from pool.acquire(priority)
        patient.waits["elevator"] += wait
        patient.elevator_wait += wait
        start = self.env.now
        patient.stages["elevator_start"] = self.env.now
        vertical_duration = self._vertical_transport_duration("elevator", floors)
        patient.vertical_travel_time += vertical_duration
        patient.travel_time += vertical_duration
        yield self.env.timeout(vertical_duration)
        patient.current_floor = target_floor
        patient.current_resource = resource_name
        patient.stages["elevator_end"] = self.env.now
        patient.stages[f"{stage}_elevator_end"] = self.env.now
        pool.release(req, start, self.env.now)

    def _use_local_resource(self, patient: Patient, resource_name: str, duration: float, priority: int, stage: str):
        pool = self.pools[resource_name]
        req, wait = yield from pool.acquire(priority)
        patient.waits[resource_name] += wait
        start = self.env.now
        patient.stages[f"{stage}_start"] = start
        yield self.env.timeout(duration)
        patient.stages[f"{stage}_end"] = self.env.now
        pool.release(req, start, self.env.now)

    def _vertical_transport_duration(self, kind: str, floors: int) -> float:
        if kind == "porter":
            duration = max(2.0, self._lognormal(5 + floors * 2.5, cv=0.25))
        else:
            duration = max(1.5, self._lognormal(2.5 + floors * 3.2, cv=0.35))
        return duration * self.config.vertical_travel_factor

    def _horizontal_transport_duration(self, origin_resource: str, target_resource: str, current_floor: int) -> float:
        if origin_resource == target_resource:
            return 0.0
        origin = self._resource_location(origin_resource, current_floor)
        target_floor = self._resource_floor(target_resource)
        target = self._resource_location(target_resource, target_floor if target_floor is not None else current_floor)
        if not origin or not target:
            return 0.0
        distance = math.hypot(origin.x - target.x, origin.y - target.y)
        if distance < 1.0:
            return 0.0
        return max(0.5, self._lognormal(0.9 + distance * 0.12, cv=0.22)) * self.config.horizontal_travel_factor

    def _resource_floor(self, resource_name: str) -> int | None:
        location = self.resource_locations.get(resource_name)
        if location:
            return location.floor
        return RESOURCE_FLOORS.get(resource_name)

    def _resource_location(self, resource_name: str, fallback_floor: int) -> ResourceLocation | None:
        location = self.resource_locations.get(resource_name)
        if location:
            return location
        floor = RESOURCE_FLOORS.get(resource_name, fallback_floor)
        defaults = {
            "entrance": (0, 6, 36),
            "triage": (0, 18, 20),
            "registration": (0, 22, 36),
            "ed_bay": (0, 42, 22),
            "ed_physician": (0, 42, 22),
            "outpatient_clinician": (0, 35, 52),
            "lab": (-1, 55, 35),
            "imaging": (-1, 62, 35),
            "pharmacy": (0, 75, 20),
            "operating_room": (1, 65, 40),
            "pacu": (1, 75, 40),
            "ward_bed": (2, 70, 55),
            "icu_bed": (1, 85, 40),
            "discharge": (0, 18, 18),
            "transport": (0, 82, 15),
            "elevator": (floor, 55, 35),
        }
        item = defaults.get(resource_name)
        if not item:
            return None
        default_floor, x, y = item
        return ResourceLocation(resource_name, default_floor if resource_name != "elevator" else floor, x, y)

    def _duration(self, kind: str, patient: Patient) -> float:
        base = {
            "triage": 7,
            "registration": 5,
            "preop_registration": 14,
            "ed_assessment": 28,
            "reassessment": 14,
            "outpatient_consult": 22,
            "lab": 42,
            "imaging": 36,
            "pharmacy": 9,
            "transport": 13,
            "surgery": 118,
            "pacu_recovery": 72,
            "discharge": 32 if self.config.early_discharge else 46,
        }[kind]
        multiplier = SEVERITY_MULTIPLIER[patient.severity]
        return max(1.0, self._lognormal(base * multiplier, cv=0.32))

    def _los(self, patient: Patient, bed_pool_name: str) -> float:
        if bed_pool_name == "icu_bed":
            hours = {"mild": 24, "moderate": 54, "severe": 84}[patient.severity]
        elif patient.stream == "elective":
            hours = {"mild": 30, "moderate": 56, "severe": 92}[patient.severity]
        else:
            hours = {"mild": 22, "moderate": 50, "severe": 88}[patient.severity]
        if self.config.early_discharge:
            hours *= 0.9
        return max(60.0, self._lognormal(hours * 60.0, cv=0.42))

    def _discharge_delay(self) -> float:
        minute_of_day = self.env.now % (24 * 60)
        hour = minute_of_day / 60.0
        if self.config.early_discharge:
            if 8 <= hour <= 15:
                return self.rng.uniform(20, 90)
            target = 9 * 60
        else:
            if 11 <= hour <= 18:
                return self.rng.uniform(80, 220)
            target = 14 * 60
        if minute_of_day <= target:
            return target - minute_of_day + self.rng.uniform(20, 90)
        return (24 * 60 - minute_of_day) + target + self.rng.uniform(20, 90)

    def _lognormal(self, mean_value: float, cv: float) -> float:
        sigma = math.sqrt(math.log(1 + cv * cv))
        mu = math.log(mean_value) - 0.5 * sigma * sigma
        return self.rng.lognormvariate(mu, sigma)

    def _kpis(self, patients: list[Patient], resource_stats: list[ResourceStats]) -> dict[str, float]:
        completed = [p for p in patients if p.completed and p.departure_time is not None]
        ed = [p for p in completed if p.stream == "ed"]
        admitted = [p for p in completed if p.admitted]
        elective = [p for p in completed if p.stream == "elective"]
        outpatient = [p for p in completed if p.stream == "outpatient"]
        ed_los = [p.departure_time - p.arrival_time for p in ed]
        total_los = [p.departure_time - p.arrival_time for p in completed]
        boarding = [p.boarding_wait for p in completed if p.boarding_wait > 0]
        pacu_boarding = [p.pacu_boarding_wait for p in completed if p.pacu_boarding_wait > 0]
        discharge_delays = [p.discharge_delay for p in admitted]
        elevator_waits = [p.elevator_wait for p in completed if p.elevator_wait > 0]
        travel_times = [p.travel_time for p in completed if p.travel_time > 0]
        horizontal_travel_times = [p.horizontal_travel_time for p in completed if p.horizontal_travel_time > 0]
        utilisation_values = [s.utilization for s in resource_stats]
        return {
            "patients_completed": float(len(completed)),
            "ed_completed": float(len(ed)),
            "outpatient_completed": float(len(outpatient)),
            "elective_completed": float(len(elective)),
            "admissions": float(len(admitted)),
            "admission_rate": len(admitted) / len(completed) if completed else 0.0,
            "ed_los_mean_min": _safe_mean(ed_los),
            "ed_los_p90_min": _percentile(ed_los, 90),
            "total_los_mean_min": _safe_mean(total_los),
            "boarding_mean_min": _safe_mean(boarding),
            "boarding_p90_min": _percentile(boarding, 90),
            "boarding_max_min": max(boarding) if boarding else 0.0,
            "pacu_boarding_mean_min": _safe_mean(pacu_boarding),
            "pacu_boarding_p90_min": _percentile(pacu_boarding, 90),
            "discharge_delay_mean_min": _safe_mean(discharge_delays),
            "elevator_wait_mean_min": _safe_mean(elevator_waits),
            "elevator_wait_p90_min": _percentile(elevator_waits, 90),
            "architecture_travel_mean_min": _safe_mean(travel_times),
            "architecture_travel_p90_min": _percentile(travel_times, 90),
            "horizontal_travel_mean_min": _safe_mean(horizontal_travel_times),
            "resource_utilization_mean": _safe_mean(utilisation_values),
            "resources_over_85pct": float(sum(1 for value in utilisation_values if value >= 0.85)),
            "incomplete_patients": float(len([p for p in patients if not p.completed])),
        }


def run_simulation(config: HospitalConfig) -> SimulationResult:
    return HospitalSimulation(config).run()


def detect_bottlenecks(kpis: dict[str, float], resource_stats: list[ResourceStats]) -> list[dict[str, Any]]:
    recommendations = {
        "triage": "Ajustar enfermeria de triaje y reglas de priorizacion en picos.",
        "registration": "Digitalizar pre-registro y separar flujos ED/ambulatorio/electivo.",
        "ed_bay": "Reducir boarding con camas aguas abajo y protocolo de surge.",
        "ed_physician": "Rebalancear turnos medicos segun curva horaria de demanda.",
        "outpatient_clinician": "Redistribuir agendas o reservar huecos para alta complejidad.",
        "lab": "Ampliar ventanas de laboratorio o priorizar pruebas criticas.",
        "imaging": "Reservar slots urgentes y extender capacidad en horas punta.",
        "pharmacy": "Separar dispensacion ambulatoria de altas hospitalarias.",
        "operating_room": "Alinear plan quirurgico con disponibilidad real de camas/PACU.",
        "pacu": "Proteger camas de recuperacion y escalonar salidas de quirofano.",
        "ward_bed": "Activar altas tempranas, lounge de alta o reconfiguracion de camas.",
        "icu_bed": "Usar step-down, criterios de transferencia y capacidad surge UCI.",
        "discharge": "Fijar objetivos de alta antes del mediodia y preparar alta desde el dia previo.",
        "transport": "Crear ventanas dedicadas para admisiones, altas y traslados quirurgicos.",
        "elevator": "Separar ascensores clinicos/logisticos y priorizar traslados ED-UCI-quirófano.",
    }
    bottlenecks: list[dict[str, Any]] = []
    for stat in resource_stats:
        score = stat.utilization * 100 + stat.wait_p90 / 6 + stat.max_queue * 1.5
        triggers = []
        if stat.utilization >= 0.85:
            triggers.append(f"ocupacion {stat.utilization:.0%}")
        if stat.wait_p90 >= 30:
            triggers.append(f"p90 espera {stat.wait_p90:.0f} min")
        if stat.max_queue > stat.capacity:
            triggers.append(f"cola maxima {stat.max_queue}")
        if triggers:
            bottlenecks.append(
                {
                    "area": stat.resource,
                    "score": round(score, 1),
                    "evidencia": ", ".join(triggers),
                    "recomendacion": recommendations.get(stat.resource, "Revisar capacidad y reglas de prioridad."),
                }
            )
    if kpis["boarding_p90_min"] >= 120:
        bottlenecks.append(
            {
                "area": "ed_boarding",
                "score": round(80 + kpis["boarding_p90_min"] / 5, 1),
                "evidencia": f"p90 boarding ED {kpis['boarding_p90_min']:.0f} min",
                "recomendacion": "Atacar primero camas de hospitalizacion, alta temprana y reglas de asignacion dinamica.",
            }
        )
    if kpis["pacu_boarding_p90_min"] >= 60:
        bottlenecks.append(
            {
                "area": "pacu_boarding",
                "score": round(70 + kpis["pacu_boarding_p90_min"] / 5, 1),
                "evidencia": f"p90 bloqueo PACU {kpis['pacu_boarding_p90_min']:.0f} min",
                "recomendacion": "No iniciar quirófano sin cama postoperatoria probable; escalonar cirugia electiva.",
            }
        )
    if kpis["discharge_delay_mean_min"] >= 240:
        bottlenecks.append(
            {
                "area": "late_discharge",
                "score": round(65 + kpis["discharge_delay_mean_min"] / 10, 1),
                "evidencia": f"demora media de alta {kpis['discharge_delay_mean_min']:.0f} min",
                "recomendacion": "Preparar altas el dia previo y medir porcentaje de altas antes de las 12:00.",
            }
        )
    bottlenecks.sort(key=lambda item: item["score"], reverse=True)
    return bottlenecks


def patient_records(patients: list[Patient]) -> list[dict[str, Any]]:
    rows = []
    for patient in patients:
        departure = patient.departure_time or patient.stages.get("departure")
        rows.append(
            {
                "id": patient.patient_id,
                "flujo": patient.stream,
                "gravedad": patient.severity,
                "destino": patient.destination,
                "ingresado": patient.admitted,
                "llegada_h": patient.arrival_time / 60,
                "salida_h": departure / 60 if departure is not None else None,
                "los_h": (departure - patient.arrival_time) / 60 if departure is not None else None,
                "boarding_min": patient.boarding_wait,
                "pacu_boarding_min": patient.pacu_boarding_wait,
                "or_block_min": patient.or_block_wait,
                "demora_alta_min": patient.discharge_delay,
                "espera_ascensor_min": patient.elevator_wait,
                "traslado_arquitectura_min": patient.travel_time,
                "traslado_horizontal_min": patient.horizontal_travel_time,
                "completado": patient.completed,
            }
        )
    return rows


def _safe_mean(values: list[float]) -> float:
    return mean(values) if values else 0.0


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = (len(ordered) - 1) * percentile / 100.0
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[int(rank)]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def flow_counts(patients: list[Patient]) -> dict[str, int]:
    return dict(Counter(p.stream for p in patients if p.completed))
