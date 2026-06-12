from __future__ import annotations

import socket
from typing import Any, cast

from fastapi import APIRouter, Request

from backend.app.api.errors import ApiError
from backend.app.services.catalog import ProductCatalog
from backend.app.services.realtime import ConnectionManager, public_state
from backend.app.services.session import SessionService

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/bootstrap")
async def bootstrap(request: Request) -> dict[str, Any]:
    catalog = cast(ProductCatalog, request.app.state.catalog)
    session = cast(SessionService, request.app.state.session_service)
    connections = cast(ConnectionManager, request.app.state.connections)
    return {
        "config": {
            "ws_studio": "/ws/studio",
            "ws_control": "/ws/control",
            "speech_capability": connections.speech_capability,
        },
        "products": [
            {
                "id": product.id,
                "category": product.category,
                "name": product.name,
                "model": product.model,
                "image": product.image,
            }
            for product in catalog.products
        ],
        "state": public_state(session.state),
    }


@router.post("/control-token")
async def control_token(request: Request) -> dict[str, str]:
    client_host = request.client.host if request.client else ""
    if client_host not in {"127.0.0.1", "::1", "testclient"}:
        raise ApiError(403, "COMMAND_FORBIDDEN", "配对信息只能从本机桌面获取")
    session = cast(SessionService, request.app.state.session_service)
    connections = cast(ConnectionManager, request.app.state.connections)
    previous_revision = session.state.revision
    token = session.issue_control_token()
    if session.state.revision != previous_revision:
        await connections.broadcast_state()
    phone_url = f"http://{_best_effort_lan_host()}:{request.url.port or 80}/control/{token}"
    return {"token": token, "phone_url": phone_url}


@router.get("/control/validate")
async def validate_control_token(request: Request, token: str) -> dict[str, Any]:
    session = cast(SessionService, request.app.state.session_service)
    connections = cast(ConnectionManager, request.app.state.connections)
    valid = session.validate_control_token(token)
    return {
        "valid": valid,
        "slot": await connections.control_slot_status() if valid else "invalid",
    }


def _best_effort_lan_host() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"
