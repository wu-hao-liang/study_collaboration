import logging
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.bootstrap import router as bootstrap_router
from backend.app.api.errors import ApiError, api_error_handler
from backend.app.api.products import router as products_router
from backend.app.api.websockets import router as websocket_router
from backend.app.config import Settings, get_settings
from backend.app.services.catalog import ProductCatalog
from backend.app.services.logging import install_token_redaction
from backend.app.services.realtime import CommandDispatcher, ConnectionManager
from backend.app.services.session import SessionService
from backend.app.storage.session_store import SessionStore

LOGGER = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    install_token_redaction()
    resolved_settings = settings or get_settings()
    catalog = ProductCatalog.load(
        resolved_settings.data_dir / "catalog.json",
        resolved_settings.data_dir / "images",
    )
    for product_id in catalog.missing_images:
        LOGGER.warning("产品 %s 的图片缺失，使用本地占位图", product_id)
    session_service = SessionService(catalog, SessionStore(resolved_settings.runtime_dir))
    connections = ConnectionManager(session_service)
    command_dispatcher = CommandDispatcher(
        session_service,
        connections,
        speech_review_ms=resolved_settings.speech_review_ms,
    )
    app = FastAPI(
        title="Live Background",
        version=_package_version(),
        docs_url="/api/docs" if resolved_settings.dev_mode else None,
        redoc_url=None,
    )
    app.state.catalog = catalog
    app.state.session_service = session_service
    app.state.connections = connections
    app.state.command_dispatcher = command_dispatcher
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(bootstrap_router)
    app.include_router(products_router)
    app.include_router(websocket_router)

    if resolved_settings.dev_mode:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "service": "live-background",
            "version": app.version,
            "checks": {
                "catalog_products": len(catalog.products),
                "missing_images": list(catalog.missing_images),
                "runtime_dir": str(resolved_settings.runtime_dir),
                "session_revision": session_service.state.revision,
            },
        }

    return app


def _package_version() -> str:
    try:
        return version("live-background")
    except PackageNotFoundError:
        return "0.1.0"


app = create_app()
