from hospital_sim.architecture import prepare_architecture_blocks, resource_locations_from_blocks
from hospital_sim.config import CapacityConfig, HospitalConfig, ResourceLocation
from hospital_sim.engine import run_simulation
from hospital_sim.game_view import build_game_payload, render_game_view
from hospital_sim.master_plan import build_master_plan
from hospital_sim.scenarios import compare_scenarios, scenario_library


def small_config(**kwargs):
    capacities = CapacityConfig(
        triage_nurses=2,
        registration_clerks=2,
        ed_bays=12,
        ed_physicians=3,
        outpatient_clinicians=4,
        lab_slots=3,
        imaging_rooms=2,
        pharmacy_windows=2,
        operating_rooms=2,
        pacu_beds=4,
        ward_beds=45,
        icu_beds=8,
        discharge_coordinators=2,
        transporters=2,
        elevators=2,
    )
    defaults = {
        "days": 4,
        "warmup_days": 1,
        "seed": 7,
        "arrival_scale": 0.55,
        "capacities": capacities,
    }
    defaults.update(kwargs)
    return HospitalConfig(**defaults)


def test_simulation_produces_core_metrics():
    result = run_simulation(small_config())

    assert result.kpis["patients_completed"] > 0
    assert result.kpis["ed_completed"] > 0
    assert result.kpis["ed_los_p90_min"] > 0
    assert result.kpis["ed_los_mean_min"] > 0
    assert len(result.resource_stats) >= 10
    assert "elevator_wait_p90_min" in result.kpis
    assert "architecture_travel_p90_min" in result.kpis
    assert any(stat.resource == "elevator" for stat in result.resource_stats)
    assert all(0 <= stat.utilization <= 1 for stat in result.resource_stats)


def test_early_discharge_changes_bed_pressure():
    base = run_simulation(small_config(seed=11))
    early = run_simulation(small_config(seed=11, early_discharge=True))

    assert early.kpis["discharge_delay_mean_min"] < base.kpis["discharge_delay_mean_min"]


def test_scenarios_are_rankable():
    config = small_config(days=3, warmup_days=0)
    rows = compare_scenarios(scenario_library(config))

    assert len(rows) >= 5
    assert all("objetivo" in row for row in rows)


def test_game_payload_contains_agent_routes():
    result = run_simulation(small_config(days=3, warmup_days=0))
    plan = build_master_plan(290_000)
    blocks = prepare_architecture_blocks(plan["architecture_options"][0])
    payload = build_game_payload(result, max_patients=25, layout_blocks=blocks)
    html = render_game_view(payload)

    assert payload["patients"]
    assert payload["layouts"]
    assert payload["rooms"]["ed"]["label"] == "Urgencias"
    assert all(patient["route"] for patient in payload["patients"])
    assert "Phaser.Game" in html


def test_master_plan_matches_target_area():
    plan = build_master_plan(290_000)
    total = sum(row["m2"] for row in plan["program"])

    assert total == 290_000
    assert any(core["core"].startswith("Escaleras") for core in plan["vertical_cores"])
    assert any(req["system"] == "Evacuacion" for req in plan["requirements"])
    assert any("CAR-T" in gap["capability"] for gap in plan["benchmark_capabilities"])
    assert len(plan["architecture_options"]) >= 4
    assert any(
        block["kind"] == "ambulance"
        for option in plan["architecture_options"]
        for block in option["blocks"]
    )
    assert any(
        block["kind"] == "waiting"
        for option in plan["architecture_options"]
        for block in option["blocks"]
    )
    assert resource_locations_from_blocks(prepare_architecture_blocks(plan["architecture_options"][0]))


def test_architecture_locations_affect_transport_metrics():
    locations = (
        ResourceLocation("registration", 0, 10, 10),
        ResourceLocation("ed_bay", 0, 90, 60),
        ResourceLocation("lab", -1, 88, 58),
        ResourceLocation("imaging", -1, 86, 56),
        ResourceLocation("ward_bed", 6, 92, 62),
        ResourceLocation("icu_bed", 4, 88, 60),
        ResourceLocation("operating_room", 3, 86, 58),
        ResourceLocation("pacu", 3, 84, 56),
    )
    result = run_simulation(
        small_config(
            days=3,
            warmup_days=0,
            resource_locations=locations,
            horizontal_travel_factor=1.25,
            vertical_travel_factor=1.2,
        )
    )

    assert result.kpis["architecture_travel_mean_min"] > 0
    assert any(patient.travel_time > 0 for patient in result.patients)
