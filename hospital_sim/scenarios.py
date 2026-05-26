from __future__ import annotations

from dataclasses import replace
from typing import Any

from .config import HospitalConfig
from .engine import SimulationResult, run_simulation


def scenario_library(base: HospitalConfig) -> dict[str, HospitalConfig]:
    caps = base.capacities
    return {
        "Base": base,
        "Alta temprana": replace(base, early_discharge=True),
        "+10 camas ward": base.with_capacity(ward_beds=caps.ward_beds + 10),
        "+4 camas UCI": base.with_capacity(icu_beds=caps.icu_beds + 4),
        "Diagnostico reforzado": base.with_capacity(lab_slots=caps.lab_slots + 2, imaging_rooms=caps.imaging_rooms + 1),
        "Surge protocol": replace(base, surge_protocol=True),
        "Camas dinamicas": replace(base, dynamic_bed_pool=True),
        "Electiva escalonada": replace(base, elective_surgery_scale=max(0.65, base.elective_surgery_scale * 0.85)),
        "Alta + camas": replace(base.with_capacity(ward_beds=caps.ward_beds + 10), early_discharge=True),
    }


def compare_scenarios(scenarios: dict[str, HospitalConfig]) -> list[dict[str, Any]]:
    rows = []
    for name, config in scenarios.items():
        result = run_simulation(config)
        rows.append(_scenario_row(name, result))
    return rows


def optimize_capacity(base: HospitalConfig, budget: float = 16.0) -> list[dict[str, Any]]:
    candidates: dict[str, HospitalConfig] = {"Base": base}
    caps = base.capacities
    for early in (False, True):
        for ward_add in (0, 8, 16, 24):
            for icu_add in (0, 3, 6):
                for diagnostic in (False, True):
                    cost = ward_add * 0.45 + icu_add * 1.7 + (2.5 if diagnostic else 0) + (2.0 if early else 0)
                    if cost > budget or cost == 0:
                        continue
                    name_parts = []
                    if early:
                        name_parts.append("alta")
                    if ward_add:
                        name_parts.append(f"ward+{ward_add}")
                    if icu_add:
                        name_parts.append(f"uci+{icu_add}")
                    if diagnostic:
                        name_parts.append("dx+")
                    config = base.with_capacity(
                        ward_beds=caps.ward_beds + ward_add,
                        icu_beds=caps.icu_beds + icu_add,
                        lab_slots=caps.lab_slots + (1 if diagnostic else 0),
                        imaging_rooms=caps.imaging_rooms + (1 if diagnostic else 0),
                    )
                    config = replace(config, early_discharge=early)
                    candidates[" + ".join(name_parts)] = config
    rows = compare_scenarios(candidates)
    rows.sort(key=lambda row: row["objetivo"])
    return rows


def _scenario_row(name: str, result: SimulationResult) -> dict[str, Any]:
    k = result.kpis
    objective = (
        k["ed_los_p90_min"]
        + 1.4 * k["boarding_p90_min"]
        + 1.2 * k["pacu_boarding_p90_min"]
        + 0.25 * k["discharge_delay_mean_min"]
        + 45 * k["resources_over_85pct"]
    )
    top_bottleneck = result.bottlenecks[0]["area"] if result.bottlenecks else "sin_alerta"
    return {
        "escenario": name,
        "objetivo": round(objective, 1),
        "pacientes": int(k["patients_completed"]),
        "ed_los_p90_min": round(k["ed_los_p90_min"], 1),
        "boarding_p90_min": round(k["boarding_p90_min"], 1),
        "pacu_boarding_p90_min": round(k["pacu_boarding_p90_min"], 1),
        "demora_alta_media_min": round(k["discharge_delay_mean_min"], 1),
        "recursos_saturados": int(k["resources_over_85pct"]),
        "principal_cuello": top_bottleneck,
    }
