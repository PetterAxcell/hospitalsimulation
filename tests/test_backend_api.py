from fastapi.testclient import TestClient

from hospital_sim.backend.adapters import hospital_config_from_plan, resource_locations_from_plan
from hospital_sim.backend.api import create_app
from hospital_sim.backend.contracts import (
    CapacityPayload,
    HospitalPlanPayload,
    PlacedRoomPayload,
    ProjectCreateRequest,
    SimulationRunRequest,
    SimulationScenarioPayload,
)
from hospital_sim.backend.services import create_backend_service


def backend_plan() -> HospitalPlanPayload:
    rooms = [
        room("registration", "Admision", "public", 0, 8, 28, 18, 12, 4, "registration"),
        room("triage", "Triaje ED", "emergency", 0, 58, 17, 11, 8, 3, "triage"),
        room("ed", "Boxes ED", "emergency", 0, 47, 27, 21, 16, 12, "ed_bay"),
        room("lab", "Core lab", "laboratory", -1, 45, 32, 18, 14, 3, "lab"),
        room("imaging", "Diagnostico imagen", "diagnostic", -1, 62, 32, 16, 12, 2, "imaging"),
        room("or", "Quirofanos", "surgery", 1, 50, 19, 23, 17, 2, "or"),
        room("pacu", "PACU", "surgery", 1, 50, 39, 22, 13, 4, "pacu"),
        room("icu", "UCI", "critical", 1, 72, 39, 18, 14, 8, "icu"),
        room("ward", "Hospitalizacion", "inpatient", 2, 16, 14, 32, 18, 45, "ward"),
        room("pharmacy", "Farmacia", "pharmacy", 0, 26, 24, 12, 10, 2, "pharmacy"),
        room("discharge", "Alta", "ambulatory", 0, 14, 16, 10, 8, 2, "discharge"),
        room("core", "Nucleo vertical", "vertical", 0, 50, 20, 8, 8, 2, "vertical_core"),
    ]
    return HospitalPlanPayload(
        id="test-plan",
        name="Plan test desacoplado",
        target_area_sqm=290_000,
        site_area_sqm=210_000,
        floors=[-1, 0, 1, 2],
        rooms=rooms,
    )


def room(
    room_id: str,
    name: str,
    kind: str,
    floor: int,
    x: float,
    y: float,
    w: float,
    h: float,
    capacity: int,
    simulation_node: str,
) -> PlacedRoomPayload:
    return PlacedRoomPayload(
        id=room_id,
        template_id=room_id,
        name=name,
        kind=kind,
        floor=floor,
        x=x,
        y=y,
        w=w,
        h=h,
        capacity=capacity,
        area_sqm=capacity * 100,
        simulation_node=simulation_node,
    )


def small_scenario() -> SimulationScenarioPayload:
    return SimulationScenarioPayload(
        days=3,
        warmup_days=0,
        seed=13,
        arrival_scale=0.35,
        capacities=CapacityPayload(
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
        ),
    )


def test_plan_adapter_builds_engine_config_from_api_contract():
    plan = backend_plan()
    config = hospital_config_from_plan(plan, small_scenario())
    resources = {location.resource for location in resource_locations_from_plan(plan)}

    assert config.architecture_name == plan.name
    assert config.capacities.ed_bays == 12
    assert config.horizontal_travel_factor > 0
    assert {"registration", "triage", "ed_bay", "operating_room", "ward_bed", "icu_bed"} <= resources


def test_backend_service_versions_plans_and_runs_simulation():
    service = create_backend_service(seed_demo=False)
    project = service.create_project(ProjectCreateRequest(name="Backend test"))
    plan_version = service.create_plan(project.id, backend_plan())

    evaluation = service.evaluate_rules(plan_version.id)
    assert evaluation.metrics["covered_pairs"] >= 5

    run = service.run_simulation(
        plan_version.id,
        SimulationRunRequest(scenario=small_scenario(), include_patients=5),
    )

    assert run.status == "completed"
    assert run.summary is not None
    assert run.summary.kpis["patients_completed"] > 0
    assert len(run.summary.patients) <= 5
    assert service.get_run(run.run_id).run_id == run.run_id


def test_fastapi_app_exposes_project_plan_and_simulation_contracts():
    service = create_backend_service(seed_demo=False)
    client = TestClient(create_app(service))

    health = client.get("/api/health")
    assert health.status_code == 200

    project_response = client.post("/api/projects", json={"name": "API test"})
    assert project_response.status_code == 201
    project_id = project_response.json()["id"]

    plan_response = client.post(
        f"/api/projects/{project_id}/plans",
        json=backend_plan().model_dump(by_alias=True),
    )
    assert plan_response.status_code == 201
    plan_id = plan_response.json()["id"]

    simulation_response = client.post(
        f"/api/plans/{plan_id}/simulations",
        json=SimulationRunRequest(scenario=small_scenario(), include_patients=3).model_dump(by_alias=True),
    )
    assert simulation_response.status_code == 202
    body = simulation_response.json()
    assert body["status"] == "completed"
    assert body["summary"]["kpis"]["patients_completed"] > 0

    fetched = client.get(f"/api/simulations/{body['runId']}")
    assert fetched.status_code == 200
    assert fetched.json()["runId"] == body["runId"]
