from __future__ import annotations

import asyncio
import time
from typing import Any, cast
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.app.services.realtime import ClientKind, CommandDispatcher, ConnectionManager
from backend.app.services.session import SessionService

router = APIRouter()
PING_INTERVAL_SECONDS = 15.0
CLIENT_TIMEOUT_SECONDS = 45.0


@router.websocket("/ws/studio")
async def studio_socket(websocket: WebSocket) -> None:
    connections, dispatcher, _session = _services(websocket)
    await connections.connect_studio(websocket)
    try:
        await _receive_commands(websocket, dispatcher, "studio")
    except WebSocketDisconnect:
        pass
    finally:
        await connections.disconnect_studio(websocket)


@router.websocket("/ws/control")
async def control_socket(websocket: WebSocket, token: str, client_id: str | None = None) -> None:
    connections, dispatcher, session = _services(websocket)
    if not session.validate_control_token(token):
        await websocket.accept()
        await websocket.close(code=4003, reason="CONTROL_TOKEN_INVALID")
        return
    resolved_client_id = client_id or str(uuid4())
    if not await connections.connect_control(websocket, resolved_client_id):
        await websocket.accept()
        await websocket.close(code=4009, reason="CONTROL_SLOT_OCCUPIED")
        return

    normal = False
    try:
        await _receive_commands(websocket, dispatcher, "control")
    except WebSocketDisconnect as exc:
        normal = exc.code in {1000, 1001}
    finally:
        await connections.disconnect_control(websocket, normal)


async def _receive_commands(
    websocket: WebSocket,
    dispatcher: CommandDispatcher,
    client: ClientKind,
) -> None:
    last_activity = time.monotonic()
    while True:
        try:
            message: dict[str, Any] = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=PING_INTERVAL_SECONDS,
            )
        except TimeoutError:
            if time.monotonic() - last_activity >= CLIENT_TIMEOUT_SECONDS:
                await websocket.close(code=4008, reason="heartbeat_timeout")
                return
            await websocket.send_json({"type": "ping"})
            continue
        last_activity = time.monotonic()
        if message.get("type") == "pong":
            continue
        ack = await dispatcher.dispatch(message, client)
        await websocket.send_json(ack)


def _services(
    websocket: WebSocket,
) -> tuple[ConnectionManager, CommandDispatcher, SessionService]:
    return (
        cast(ConnectionManager, websocket.app.state.connections),
        cast(CommandDispatcher, websocket.app.state.command_dispatcher),
        cast(SessionService, websocket.app.state.session_service),
    )
