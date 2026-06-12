from __future__ import annotations

import json
import os
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from backend.app.domain.session import SCHEMA_VERSION, NewSession, SessionState, create_new_session


class SessionStorageError(RuntimeError):
    """Raised when session state cannot be safely read or persisted."""


class UnsupportedSessionSchema(SessionStorageError):
    """Raised when a state file uses an unknown schema version."""


class SessionStore:
    def __init__(self, runtime_dir: Path) -> None:
        self.runtime_dir = runtime_dir
        self.session_path = runtime_dir / "session.json"
        self.temp_path = runtime_dir / "session.json.tmp"

    def load_or_create(
        self,
        valid_product_ids: set[str],
        now: datetime | None = None,
    ) -> NewSession:
        if not self.session_path.exists():
            new_session = create_new_session(now)
            self.save(new_session.state)
            return new_session

        try:
            raw_state = json.loads(self.session_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            self._backup_corrupt_file(now)
            new_session = create_new_session(now)
            self.save(new_session.state)
            return new_session

        if not isinstance(raw_state, dict):
            return self._replace_invalid_state(now)

        if "schema_version" not in raw_state:
            return self._replace_invalid_state(now)

        schema_version = raw_state["schema_version"]
        if schema_version != SCHEMA_VERSION:
            raise UnsupportedSessionSchema(f"不支持的会话状态 schema_version: {schema_version!r}")

        try:
            state = SessionState.model_validate(raw_state)
        except ValidationError:
            return self._replace_invalid_state(now)

        repaired_state = self._repair_removed_products(state, valid_product_ids, now)
        if repaired_state is not state:
            self.save(repaired_state)
        return NewSession(state=repaired_state, control_token="")

    def save(self, state: SessionState) -> None:
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        payload = state.model_dump_json(indent=2)
        try:
            with self.temp_path.open("w", encoding="utf-8", newline="\n") as handle:
                handle.write(payload)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(self.temp_path, self.session_path)
        except OSError as exc:
            with suppress(OSError):
                self.temp_path.unlink(missing_ok=True)
            raise SessionStorageError("无法持久化会话状态") from exc

    def _replace_invalid_state(self, now: datetime | None) -> NewSession:
        self._backup_corrupt_file(now)
        new_session = create_new_session(now)
        self.save(new_session.state)
        return new_session

    def _backup_corrupt_file(self, now: datetime | None) -> None:
        if not self.session_path.exists():
            return
        timestamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%S%fZ")
        backup_path = self.runtime_dir / f"session.corrupt-{timestamp}.json"
        try:
            os.replace(self.session_path, backup_path)
        except OSError as exc:
            raise SessionStorageError("无法备份损坏的会话状态") from exc

    @staticmethod
    def _repair_removed_products(
        state: SessionState,
        valid_product_ids: set[str],
        now: datetime | None,
    ) -> SessionState:
        selected_product_id = state.selected_product_id
        prices = {
            product_id: price
            for product_id, price in state.prices.items()
            if product_id in valid_product_ids
        }
        if selected_product_id not in valid_product_ids:
            selected_product_id = None

        if selected_product_id == state.selected_product_id and prices == state.prices:
            return state

        return state.model_copy(
            update={
                "selected_product_id": selected_product_id,
                "prices": prices,
                "revision": state.revision + 1,
                "updated_at": now or datetime.now(UTC),
            }
        )
