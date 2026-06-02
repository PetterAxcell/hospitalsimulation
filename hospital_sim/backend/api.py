from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .contracts import (
    CatalogResponse,
    HospitalPlanPayload,
    PlanVersionResponse,
    ProjectCreateRequest,
    ProjectResponse,
    RuleEvaluationResponse,
    SimulationRunRequest,
    SimulationRunResponse,
)
from .repository import NotFoundError
from .services import BackendService, create_backend_service


def create_app(service: BackendService | None = None) -> FastAPI:
    app = FastAPI(
        title="Hospital Simulation Backend",
        version="0.1.0",
        description="Decoupled API for plans, rule evaluation and reproducible simulation runs.",
    )
    app.state.backend_service = service or create_backend_service()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def get_service() -> BackendService:
        return app.state.backend_service

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/catalog", response_model=CatalogResponse)
    def catalog(service: BackendService = Depends(get_service)) -> CatalogResponse:
        return service.catalog()

    @app.get("/api/projects", response_model=list[ProjectResponse])
    def list_projects(service: BackendService = Depends(get_service)) -> list[ProjectResponse]:
        return service.list_projects()

    @app.post("/api/projects", response_model=ProjectResponse, status_code=201)
    def create_project(
        request: ProjectCreateRequest,
        service: BackendService = Depends(get_service),
    ) -> ProjectResponse:
        return service.create_project(request)

    @app.post("/api/projects/{project_id}/plans", response_model=PlanVersionResponse, status_code=201)
    def create_plan(
        project_id: str,
        plan: HospitalPlanPayload,
        service: BackendService = Depends(get_service),
    ) -> PlanVersionResponse:
        try:
            return service.create_plan(project_id, plan)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/projects/{project_id}/plans/latest", response_model=PlanVersionResponse)
    def latest_plan(project_id: str, service: BackendService = Depends(get_service)) -> PlanVersionResponse:
        try:
            return service.get_latest_plan(project_id)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/plans/{plan_id}", response_model=PlanVersionResponse)
    def get_plan(plan_id: str, service: BackendService = Depends(get_service)) -> PlanVersionResponse:
        try:
            return service.get_plan(plan_id)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/plans/{plan_id}/rules/evaluate", response_model=RuleEvaluationResponse)
    def evaluate_rules(plan_id: str, service: BackendService = Depends(get_service)) -> RuleEvaluationResponse:
        try:
            return service.evaluate_rules(plan_id)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/plans/{plan_id}/simulations", response_model=SimulationRunResponse, status_code=202)
    def run_simulation(
        plan_id: str,
        request: SimulationRunRequest,
        service: BackendService = Depends(get_service),
    ) -> SimulationRunResponse:
        try:
            return service.run_simulation(plan_id, request)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/simulations/{run_id}", response_model=SimulationRunResponse)
    def get_run(run_id: str, service: BackendService = Depends(get_service)) -> SimulationRunResponse:
        try:
            return service.get_run(run_id)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return app


app = create_app()
