from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast
from uuid import UUID, uuid4

from fastapi import WebSocket
from pydantic import ValidationError

from backend.app.domain.protocol import CommandEnvelope
from backend.app.domain.session import ActivePanel, SessionState, SpeechTarget
from backend.app.services.session import SessionCommandError, SessionService
from backend.app.storage.session_store import SessionStorageError

ClientKind = Literal["studio", "control"]
SpeechCapability = Literal["uninitialized", "ready", "unsupported", "denied", "unavailable"]
REQUEST_CACHE_LIMIT = 256


@dataclass
class ControlSlot:
    client_id: str
    websocket: WebSocket | None
    disconnected_at: float | None = None


class ConnectionManager:
    def __init__(
        self,
        session_service: SessionService,
        reconnect_grace_seconds: float = 15.0,
    ) -> None:
        self.session_service = session_service
        self.reconnect_grace_seconds = reconnect_grace_seconds
        self.studio: WebSocket | None = None
        self.control_slot: ControlSlot | None = None
        self.speech_capability: SpeechCapability = "uninitialized"
        self._lock = asyncio.Lock()

    async def connect_studio(self, websocket: WebSocket) -> None:
        await websocket.accept()
        previous: WebSocket | None
        async with self._lock:
            previous = self.studio
            self.studio = websocket
        if previous is not None and previous is not websocket:
            await _safe_close(previous, 4001, "studio_replaced")
        await websocket.send_json(state_event(self.session_service.state))

    async def disconnect_studio(self, websocket: WebSocket) -> None:
        changed = False
        async with self._lock:
            if self.studio is websocket:
                self.studio = None
                changed = self.speech_capability != "uninitialized"
                self.speech_capability = "uninitialized"
        if changed:
            await self.broadcast_json(speech_capability_event("uninitialized"))

    async def connect_control(
        self,
        websocket: WebSocket,
        client_id: str,
    ) -> bool:
        async with self._lock:
            self._expire_control_slot_locked()
            slot = self.control_slot
            if slot is not None and (slot.websocket is not None or slot.client_id != client_id):
                return False
            await websocket.accept()
            self.control_slot = ControlSlot(client_id=client_id, websocket=websocket)
        await websocket.send_json(state_event(self.session_service.state))
        return True

    async def disconnect_control(self, websocket: WebSocket, normal: bool) -> None:
        async with self._lock:
            slot = self.control_slot
            if slot is None or slot.websocket is not websocket:
                return
            if normal:
                self.control_slot = None
            else:
                slot.websocket = None
                slot.disconnected_at = time.monotonic()

    async def control_slot_status(self) -> str:
        async with self._lock:
            self._expire_control_slot_locked()
            return "available" if self.control_slot is None else "occupied"

    async def broadcast_state(self) -> None:
        await self.broadcast_json(state_event(self.session_service.state))

    async def broadcast_json(self, message: dict[str, Any]) -> None:
        async with self._lock:
            sockets = [
                socket
                for socket in (
                    self.studio,
                    self.control_slot.websocket if self.control_slot else None,
                )
                if socket is not None
            ]
        for socket in sockets:
            try:
                await socket.send_json(message)
            except RuntimeError:
                continue

    async def invalidate_controls(self) -> None:
        async with self._lock:
            socket = self.control_slot.websocket if self.control_slot else None
            self.control_slot = None
        if socket is not None:
            await _safe_close(socket, 4003, "session_ended")

    async def set_speech_capability(self, status: SpeechCapability) -> None:
        self.speech_capability = status
        await self.broadcast_json(speech_capability_event(status))

    def _expire_control_slot_locked(self) -> None:
        slot = self.control_slot
        if (
            slot is not None
            and slot.websocket is None
            and slot.disconnected_at is not None
            and time.monotonic() - slot.disconnected_at >= self.reconnect_grace_seconds
        ):
            self.control_slot = None


class CommandDispatcher:
    def __init__(
        self,
        session_service: SessionService,
        connections: ConnectionManager,
        speech_review_ms: int = 3000,
    ) -> None:
        self.session_service = session_service
        self.connections = connections
        self.speech_review_ms = speech_review_ms
        self._request_cache: OrderedDict[UUID, dict[str, Any]] = OrderedDict()
        self._lock = asyncio.Lock()
        self._speech_deadline_task: asyncio.Task[None] | None = None

    async def dispatch(self, raw_message: dict[str, Any], client: ClientKind) -> dict[str, Any]:
        try:
            command = CommandEnvelope.model_validate(raw_message)
        except ValidationError as exc:
            return {
                "type": "ack",
                "request_id": str(raw_message.get("request_id", "")),
                "ok": False,
                "revision": self.session_service.state.revision,
                "error": {
                    "code": "INVALID_COMMAND",
                    "message": "命令格式无效",
                    "details": {"errors": exc.errors(include_url=False)},
                },
            }

        async with self._lock:
            cached = self._request_cache.get(command.request_id)
            if cached is not None:
                return cached
            result = await self._execute(command, client)
            self._request_cache[command.request_id] = result
            self._request_cache.move_to_end(command.request_id)
            while len(self._request_cache) > REQUEST_CACHE_LIMIT:
                self._request_cache.popitem(last=False)
            return result

    async def _execute(
        self,
        envelope: CommandEnvelope,
        client: ClientKind,
    ) -> dict[str, Any]:
        if client == "control" and envelope.command in {"end_session", "speech_capability"}:
            return self._error_ack(
                envelope,
                "COMMAND_FORBIDDEN",
                "手机控制端不能执行此命令",
            )

        try:
            if envelope.command == "speech_capability":
                status = str(envelope.payload["status"])
                if status not in {
                    "uninitialized",
                    "ready",
                    "unsupported",
                    "denied",
                    "unavailable",
                }:
                    raise SessionCommandError("INVALID_COMMAND", "语音能力状态无效")
                await self.connections.set_speech_capability(cast(SpeechCapability, status))
                return self._success_ack(envelope)
            if envelope.command == "speech_confirm":
                await self._commit_speech(envelope)
                return self._success_ack(envelope)
            changed = self._apply_persistent_command(envelope)
            if changed:
                await self.connections.broadcast_state()
            if envelope.command == "speech_started":
                self._cancel_speech_deadline()
            if envelope.command == "speech_stopped":
                self._schedule_speech_deadline()
            if envelope.command in {"speech_cancel", "speech_failed", "end_session"}:
                self._cancel_speech_deadline()
            if (
                changed
                and envelope.command == "set_price"
                and str(envelope.payload.get("product_id"))
                == self.session_service.state.selected_product_id
            ):
                await self._broadcast_named_animation("price_highlight")
            if envelope.command == "end_session":
                await self.connections.invalidate_controls()
            if envelope.command == "trigger_animation":
                await self._broadcast_animation(envelope)
            return self._success_ack(envelope)
        except SessionCommandError as exc:
            return self._error_ack(envelope, exc.code, exc.message, exc.details)
        except SessionStorageError:
            return self._error_ack(
                envelope,
                "STATE_STORAGE_FAILED",
                "状态保存失败，请重试",
            )
        except (KeyError, TypeError, ValueError):
            return self._error_ack(envelope, "INVALID_COMMAND", "命令参数无效")

    def _apply_persistent_command(self, envelope: CommandEnvelope) -> bool:
        command = envelope.command
        if command == "trigger_animation":
            return False

        expected_revision = envelope.expected_revision
        if expected_revision is None:
            raise SessionCommandError("INVALID_COMMAND", "持久状态命令缺少 expected_revision")

        before = self.session_service.state
        payload = envelope.payload
        if command == "select_product":
            self.session_service.select_product(
                str(payload["product_id"]),
                expected_revision,
            )
        elif command == "set_price":
            self.session_service.set_price(
                str(payload["product_id"]),
                str(payload["raw_value"]),
                expected_revision,
            )
        elif command == "set_panel":
            self.session_service.set_panel(
                ActivePanel(str(payload["panel"])),
                expected_revision,
            )
        elif command == "set_gesture_enabled":
            self.session_service.set_gesture_enabled(
                _strict_bool(payload["enabled"]),
                expected_revision,
            )
        elif command == "speech_set_target":
            self.session_service.set_speech_target(
                SpeechTarget(str(payload["target"])),
                expected_revision,
            )
        elif command == "speech_started":
            self.session_service.speech_started(expected_revision)
        elif command == "speech_interim":
            self.session_service.speech_interim(
                str(payload["text"]),
                expected_revision,
            )
        elif command == "speech_stopped":
            raw_text = payload.get("text")
            self.session_service.speech_stopped(
                None if raw_text is None else str(raw_text),
                expected_revision,
                self.speech_review_ms,
            )
        elif command == "speech_edit_draft":
            self.session_service.speech_edit_draft(
                str(payload["text"]),
                expected_revision,
            )
        elif command == "speech_cancel":
            self.session_service.speech_cancel(expected_revision)
        elif command == "speech_failed":
            self.session_service.speech_fail(
                str(payload["error_code"]),
                expected_revision,
            )
        elif command == "end_session":
            self.session_service.end_session(expected_revision)
        else:
            raise SessionCommandError("INVALID_COMMAND", "不支持的命令")
        return self.session_service.state != before

    async def _commit_speech(self, envelope: CommandEnvelope) -> None:
        expected_revision = envelope.expected_revision
        if expected_revision is None:
            raise SessionCommandError("INVALID_COMMAND", "持久状态命令缺少 expected_revision")
        self._cancel_speech_deadline()
        self.session_service.speech_begin_commit(expected_revision)
        await self.connections.broadcast_state()
        self.session_service.speech_finish_commit()
        await self.connections.broadcast_state()

    def _schedule_speech_deadline(self) -> None:
        self._cancel_speech_deadline()
        if self.session_service.state.speech.phase.value != "reviewing":
            return
        self._speech_deadline_task = asyncio.create_task(self._auto_commit_speech())

    def _cancel_speech_deadline(self) -> None:
        task = self._speech_deadline_task
        self._speech_deadline_task = None
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    async def _auto_commit_speech(self) -> None:
        try:
            await asyncio.sleep(self.speech_review_ms / 1000)
            async with self._lock:
                if self.session_service.state.speech.phase.value != "reviewing":
                    return
                revision = self.session_service.state.revision
                self.session_service.speech_begin_commit(revision)
                await self.connections.broadcast_state()
                self.session_service.speech_finish_commit()
                await self.connections.broadcast_state()
        except asyncio.CancelledError:
            return
        finally:
            if self._speech_deadline_task is asyncio.current_task():
                self._speech_deadline_task = None

    async def _broadcast_animation(self, envelope: CommandEnvelope) -> None:
        name = str(envelope.payload["name"])
        if name not in {"price_highlight", "product_spotlight"}:
            raise SessionCommandError("INVALID_COMMAND", "动画名称无效")
        await self._broadcast_named_animation(name)

    async def _broadcast_named_animation(self, name: str) -> None:
        await self.connections.broadcast_json(
            {
                "type": "animation",
                "event_id": str(uuid4()),
                "name": name,
                "product_id": self.session_service.state.selected_product_id,
                "issued_at": datetime.now(UTC).isoformat(),
            }
        )

    def _success_ack(self, envelope: CommandEnvelope) -> dict[str, Any]:
        return {
            "type": "ack",
            "request_id": str(envelope.request_id),
            "ok": True,
            "revision": self.session_service.state.revision,
            "error": None,
        }

    def _error_ack(
        self,
        envelope: CommandEnvelope,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "type": "ack",
            "request_id": str(envelope.request_id),
            "ok": False,
            "revision": self.session_service.state.revision,
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            },
        }


def public_state(state: SessionState) -> dict[str, Any]:
    return state.model_dump(mode="json", exclude={"control_token_hash"})


def state_event(state: SessionState) -> dict[str, Any]:
    return {
        "type": "state",
        "event_id": str(uuid4()),
        "revision": state.revision,
        "state": public_state(state),
    }


def speech_capability_event(status: SpeechCapability) -> dict[str, Any]:
    return {
        "type": "speech_capability",
        "status": status,
    }


def _strict_bool(value: Any) -> bool:
    if not isinstance(value, bool):
        raise TypeError("expected boolean")
    return value


async def _safe_close(websocket: WebSocket, code: int, reason: str) -> None:
    with suppress(RuntimeError):
        await websocket.close(code=code, reason=reason)
