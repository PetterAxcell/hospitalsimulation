from __future__ import annotations

from hospital_sim.architecture import block_floors, prepare_architecture_blocks
from hospital_sim.engine import run_simulation
from hospital_sim.master_plan import build_master_plan

from .adapters import (
    SIMULATION_NODE_TO_RESOURCES,
    architecture_metrics_from_plan,
    frontend_node_for_resources,
    hospital_config_from_plan,
    rule_warnings_for_plan,
    simulation_summary_from_result,
)
from .contracts import (
    CatalogResponse,
    HospitalPlanPayload,
    PlacedRoomPayload,
    PlanVersionResponse,
    ProjectCreateRequest,
    ProjectResponse,
    ResourceDefinition,
    RuleEvaluationResponse,
    SimulationRunRequest,
    SimulationRunResponse,
)
from .repository import InMemoryBackendRepository


ENGINE_VERSION = "simpy-des-0.1"


class BackendService:
    def __init__(self, repository: InMemoryBackendRepository | None = None) -> None:
        self.repository = repository or InMemoryBackendRepository()

    def catalog(self) -> CatalogResponse:
        return CatalogResponse(
            resources=[
                ResourceDefinition(resource="triage", label="Triage nurses", default_floor=0, capacity_field="triage_nurses"),
                ResourceDefinition(
                    resource="registration",
                    label="Registration clerks",
                    default_floor=0,
                    capacity_field="registration_clerks",
                ),
                ResourceDefinition(resource="ed_bay", label="ED bays", default_floor=0, capacity_field="ed_bays"),
                ResourceDefinition(resource="ed_physician", label="ED physicians", default_floor=0, capacity_field="ed_physicians"),
                ResourceDefinition(
                    resource="outpatient_clinician",
                    label="Outpatient clinicians",
                    default_floor=0,
                    capacity_field="outpatient_clinicians",
                ),
                ResourceDefinition(resource="lab", label="Lab slots", default_floor=-1, capacity_field="lab_slots"),
                ResourceDefinition(resource="imaging", label="Imaging rooms", default_floor=-1, capacity_field="imaging_rooms"),
                ResourceDefinition(resource="pharmacy", label="Pharmacy windows", default_floor=0, capacity_field="pharmacy_windows"),
                ResourceDefinition(
                    resource="operating_room",
                    label="Operating rooms",
                    default_floor=1,
                    capacity_field="operating_rooms",
                ),
                ResourceDefinition(resource="pacu", label="PACU beds", default_floor=1, capacity_field="pacu_beds"),
                ResourceDefinition(resource="ward_bed", label="Ward beds", default_floor=2, capacity_field="ward_beds"),
                ResourceDefinition(resource="icu_bed", label="ICU beds", default_floor=1, capacity_field="icu_beds"),
                ResourceDefinition(
                    resource="discharge",
                    label="Discharge coordinators",
                    default_floor=0,
                    capacity_field="discharge_coordinators",
                ),
                ResourceDefinition(resource="transport", label="Transporters", default_floor=0, capacity_field="transporters"),
                ResourceDefinition(resource="elevator", label="Clinical elevators", default_floor=0, capacity_field="elevators"),
            ],
            simulation_node_mapping={key: list(value) for key, value in SIMULATION_NODE_TO_RESOURCES.items()},
        )

    def list_projects(self) -> list[ProjectResponse]:
        return self.repository.list_projects()

    def create_project(self, request: ProjectCreateRequest) -> ProjectResponse:
        return self.repository.create_project(request)

    def create_plan(self, project_id: str, plan: HospitalPlanPayload) -> PlanVersionResponse:
        return self.repository.create_plan(project_id, plan)

    def get_latest_plan(self, project_id: str) -> PlanVersionResponse:
        return self.repository.get_latest_plan(project_id)

    def get_plan(self, plan_id: str) -> PlanVersionResponse:
        return self.repository.get_plan(plan_id)

    def evaluate_rules(self, plan_id: str) -> RuleEvaluationResponse:
        plan_version = self.repository.get_plan(plan_id)
        return RuleEvaluationResponse(
            plan_id=plan_id,
            metrics=architecture_metrics_from_plan(plan_version.plan),
            warnings=rule_warnings_for_plan(plan_version.plan),
        )

    def run_simulation(self, plan_id: str, request: SimulationRunRequest) -> SimulationRunResponse:
        plan_version = self.repository.get_plan(plan_id)
        config = hospital_config_from_plan(plan_version.plan, request.scenario)
        result = run_simulation(config)
        summary = simulation_summary_from_result(result, patient_limit=request.include_patients)
        return self.repository.create_run(plan_id, request.scenario, summary, ENGINE_VERSION)

    def get_run(self, run_id: str) -> SimulationRunResponse:
        return self.repository.get_run(run_id)


def create_backend_service(seed_demo: bool = True) -> BackendService:
    service = BackendService()
    if seed_demo:
        project = service.create_project(
            ProjectCreateRequest(
                name="Hospital terciario demo",
                target_area_sqm=290_000,
                site_area_sqm=210_000,
            )
        )
        service.create_plan(project.id, demo_plan_from_master_plan())
    return service


def demo_plan_from_master_plan(target_area_sqm: int = 290_000) -> HospitalPlanPayload:
    master_plan = build_master_plan(target_area_sqm)
    option = master_plan["architecture_options"][0]
    blocks = prepare_architecture_blocks(option)
    rooms: list[PlacedRoomPayload] = []
    floors: set[int] = set()
    for block in blocks:
        block_floor_values = block_floors(block)
        floor = block_floor_values[0]
        floors.update(block_floor_values)
        resources = [item.strip() for item in str(block.get("node", "")).split(",") if item.strip()]
        rooms.append(
            PlacedRoomPayload(
                id=str(block["id"]),
                name=str(block["name"]),
                kind=_api_kind(str(block.get("kind", "public"))),
                floor=floor,
                x=float(block.get("x", 0)),
                y=float(block.get("y", 0)),
                w=float(block.get("w", 10)),
                h=float(block.get("h", 8)),
                capacity=1,
                area_sqm=0,
                simulation_node=frontend_node_for_resources(resources),
            )
        )
    return HospitalPlanPayload(
        id="demo-architecture-option",
        name=str(option["option"]),
        target_area_sqm=float(target_area_sqm),
        site_area_sqm=210_000,
        floors=sorted(floors) or [0],
        rooms=rooms,
    )


def _api_kind(kind: str) -> str:
    return {
        "ambulance": "emergency",
        "maternal_child": "maternalChild",
        "garden": "green",
    }.get(kind, kind)
