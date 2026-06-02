"""Backend API and service layer for the hospital simulator."""

from .services import BackendService, create_backend_service

__all__ = ["BackendService", "create_backend_service"]
