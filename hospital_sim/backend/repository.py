from __future__ import annotations

from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4

from .contracts import (
    HospitalPlanPayload,
    PlanVersionResponse,
    ProjectCreateRequest,
    ProjectResponse,
    SimulationRunResponse,
    SimulationScenarioPayload,
    SimulationSummary,
)


class NotFoundError(LookupError):
    """Raised when a backend resource does not exist."""


class InMemoryBackendRepository:
    """Small repository boundary that can later be replaced by PostgreSQL."""

    def __init__(self) -> None:
        self._projects: dict[str, ProjectResponse] = {}
        self._plans: dict[str, PlanVersionResponse] = {}
        self._project_plan_ids: dict[str, list[str]] = {}
        self._runs: dict[str, SimulationRunResponse] = {}
        self._lock = RLock()

    def list_projects(self) -> list[ProjectResponse]:
        with self._lock:
            return [project.model_copy(deep=True) for project in self._projects.values()]

    def create_project(self, request: ProjectCreateRequest) -> ProjectResponse:
        with self._lock:
            project = ProjectResponse(
                id=f"proj_{uuid4().hex[:12]}",
                name=request.name,
                target_area_sqm=request.target_area_sqm,
                site_area_sqm=request.site_area_sqm,
                created_at=_now(),
            )
            self._projects[project.id] = project
            self._project_plan_ids[project.id] = []
            return project.model_copy(deep=True)

    def get_project(self, project_id: str) -> ProjectResponse:
        with self._lock:
            try:
                return self._projects[project_id].model_copy(deep=True)
            except KeyError as exc:
                raise NotFoundError(f"project not found: {project_id}") from exc

    def create_plan(self, project_id: str, plan: HospitalPlanPayload) -> PlanVersionResponse:
        with self._lock:
            if project_id not in self._projects:
                raise NotFoundError(f"project not found: {project_id}")
            existing_versions = self._project_plan_ids.setdefault(project_id, [])
            version = len(existing_versions) + 1
            plan_version = PlanVersionResponse(
                id=f"plan_{uuid4().hex[:12]}",
                project_id=project_id,
                version=version,
                plan=plan,
                created_at=_now(),
            )
            self._plans[plan_version.id] = plan_version
            existing_versions.append(plan_version.id)
            return plan_version.model_copy(deep=True)

    def get_plan(self, plan_id: str) -> PlanVersionResponse:
        with self._lock:
            try:
                return self._plans[plan_id].model_copy(deep=True)
            except KeyError as exc:
                raise NotFoundError(f"plan not found: {plan_id}") from exc

    def get_latest_plan(self, project_id: str) -> PlanVersionResponse:
        with self._lock:
            if project_id not in self._projects:
                raise NotFoundError(f"project not found: {project_id}")
            plan_ids = self._project_plan_ids.get(project_id, [])
            if not plan_ids:
                raise NotFoundError(f"project has no plans: {project_id}")
            return self._plans[plan_ids[-1]].model_copy(deep=True)

    def create_run(
        self,
        plan_id: str,
        scenario: SimulationScenarioPayload,
        summary: SimulationSummary,
        engine_version: str,
    ) -> SimulationRunResponse:
        with self._lock:
            if plan_id not in self._plans:
                raise NotFoundError(f"plan not found: {plan_id}")
            now = _now()
            run = SimulationRunResponse(
                run_id=f"run_{uuid4().hex[:12]}",
                plan_id=plan_id,
                status="completed",
                scenario=scenario,
                summary=summary,
                engine_version=engine_version,
                created_at=now,
                completed_at=now,
            )
            self._runs[run.run_id] = run
            return run.model_copy(deep=True)

    def get_run(self, run_id: str) -> SimulationRunResponse:
        with self._lock:
            try:
                return self._runs[run_id].model_copy(deep=True)
            except KeyError as exc:
                raise NotFoundError(f"simulation run not found: {run_id}") from exc


def _now() -> datetime:
    return datetime.now(UTC)
