from __future__ import annotations

import hmac
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.app.domain.money import MoneyParseError, parse_money
from backend.app.domain.session import (
    ActivePanel,
    SessionState,
    SpeechPhase,
    SpeechState,
    SpeechTarget,
    create_new_session,
    generate_control_token,
    hash_control_token,
)
from backend.app.services.catalog import ProductCatalog
from backend.app.storage.session_store import SessionStore


class SessionCommandError(ValueError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class SessionService:
    def __init__(
        self,
        catalog: ProductCatalog,
        store: SessionStore,
        now: datetime | None = None,
    ) -> None:
        self._catalog = catalog
        self._store = store
        loaded = store.load_or_create({product.id for product in catalog.products}, now)
        self._state = loaded.state
        self._control_token = loaded.control_token or None

    @property
    def state(self) -> SessionState:
        return self._state

    @property
    def control_token(self) -> str | None:
        return self._control_token

    def issue_control_token(self, now: datetime | None = None) -> str:
        if self._control_token is not None:
            return self._control_token
        token = generate_control_token()
        next_state = self._state.model_copy(
            update={
                "control_token_hash": hash_control_token(token),
                "revision": self._state.revision + 1,
                "updated_at": now or datetime.now(UTC),
            }
        )
        self._store.save(next_state)
        self._state = next_state
        self._control_token = token
        return token

    def validate_control_token(self, token: str) -> bool:
        candidate_hash = hash_control_token(token)
        return hmac.compare_digest(candidate_hash, self._state.control_token_hash)

    def select_product(
        self,
        product_id: str,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        if self._catalog.get(product_id) is None:
            raise SessionCommandError(
                "PRODUCT_NOT_FOUND",
                "未找到指定产品",
                {"product_id": product_id},
            )
        return self._commit({"selected_product_id": product_id}, now)

    def set_price(
        self,
        product_id: str,
        raw_value: str,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        if self._catalog.get(product_id) is None:
            raise SessionCommandError(
                "PRODUCT_NOT_FOUND",
                "未找到指定产品",
                {"product_id": product_id},
            )
        try:
            amount = parse_money(raw_value)
        except MoneyParseError as exc:
            raise SessionCommandError(exc.code, exc.message) from exc
        prices = dict(self._state.prices)
        prices[product_id] = amount
        return self._commit({"prices": prices}, now)

    def set_panel(
        self,
        panel: ActivePanel,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        return self._commit({"active_panel": panel}, now)

    def set_gesture_enabled(
        self,
        enabled: bool,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        gesture = self._state.gesture.model_copy(update={"enabled": enabled})
        return self._commit({"gesture": gesture}, now)

    def set_speech_target(
        self,
        target: SpeechTarget,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        speech = self._state.speech.model_copy(update={"target": target})
        return self._commit({"speech": speech}, now)

    def speech_started(
        self,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        speech = SpeechState(
            phase=SpeechPhase.LISTENING,
            target=self._state.speech.target,
        )
        return self._commit({"speech": speech}, now)

    def speech_interim(
        self,
        text: str,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        self._require_speech_phase(SpeechPhase.LISTENING)
        speech = self._state.speech.model_copy(update={"draft": text.strip()})
        return self._commit({"speech": speech}, now)

    def speech_stopped(
        self,
        text: str | None,
        expected_revision: int,
        review_ms: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        self._require_speech_phase(SpeechPhase.LISTENING)
        timestamp = now or datetime.now(UTC)
        draft = self._state.speech.draft if text is None else text.strip()
        if not draft:
            speech = self._state.speech.model_copy(
                update={
                    "phase": SpeechPhase.ERROR,
                    "draft": "",
                    "deadline": None,
                    "error_code": "EMPTY_SPEECH",
                }
            )
        else:
            speech = self._state.speech.model_copy(
                update={
                    "phase": SpeechPhase.REVIEWING,
                    "draft": draft,
                    "deadline": timestamp + timedelta(milliseconds=review_ms),
                    "error_code": None,
                }
            )
        return self._commit({"speech": speech}, timestamp)

    def speech_edit_draft(
        self,
        text: str,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        self._require_speech_phase(SpeechPhase.REVIEWING)
        speech = self._state.speech.model_copy(update={"draft": text.strip()})
        return self._commit({"speech": speech}, now)

    def speech_begin_commit(
        self,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        self._require_speech_phase(SpeechPhase.REVIEWING)
        speech = self._state.speech.model_copy(
            update={"phase": SpeechPhase.COMMITTING, "deadline": None}
        )
        return self._commit({"speech": speech}, now)

    def speech_finish_commit(self, now: datetime | None = None) -> SessionState:
        self._require_speech_phase(SpeechPhase.COMMITTING)
        speech = self._state.speech
        draft = speech.draft.strip()
        if not draft:
            return self._speech_error("EMPTY_SPEECH", now)

        updates: dict[str, Any] = {}
        if speech.target is SpeechTarget.PRICE:
            product_id = self._state.selected_product_id
            if product_id is None:
                return self._speech_error("NO_PRODUCT_SELECTED", now)
            try:
                amount = parse_money(draft)
            except MoneyParseError as exc:
                return self._speech_error(exc.code, now)
            prices = dict(self._state.prices)
            prices[product_id] = amount
            updates["prices"] = prices

        updates["speech"] = SpeechState(target=speech.target)
        return self._commit(updates, now)

    def speech_cancel(
        self,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        speech = SpeechState(target=self._state.speech.target)
        return self._commit({"speech": speech}, now)

    def speech_fail(
        self,
        error_code: str,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        return self._speech_error(error_code, now)

    def end_session(
        self,
        expected_revision: int,
        now: datetime | None = None,
    ) -> SessionState:
        self._require_revision(expected_revision)
        new_session = create_new_session(now)
        next_state = new_session.state
        self._store.save(next_state)
        self._state = next_state
        self._control_token = new_session.control_token
        return self._state

    def _require_revision(self, expected_revision: int) -> None:
        if expected_revision != self._state.revision:
            raise SessionCommandError(
                "REVISION_CONFLICT",
                "状态版本已更新，请重试",
                {
                    "state": self._state.model_dump(
                        mode="json",
                        exclude={"control_token_hash"},
                    )
                },
            )

    def _require_speech_phase(self, phase: SpeechPhase) -> None:
        if self._state.speech.phase is not phase:
            raise SessionCommandError(
                "INVALID_SPEECH_STATE",
                "当前语音状态不允许此操作",
                {"phase": self._state.speech.phase.value},
            )

    def _speech_error(
        self,
        error_code: str,
        now: datetime | None,
    ) -> SessionState:
        speech = self._state.speech.model_copy(
            update={
                "phase": SpeechPhase.ERROR,
                "deadline": None,
                "error_code": error_code,
            }
        )
        return self._commit({"speech": speech}, now)

    def _commit(
        self,
        updates: dict[str, Any],
        now: datetime | None,
    ) -> SessionState:
        unchanged = all(getattr(self._state, key) == value for key, value in updates.items())
        if unchanged:
            return self._state
        next_state = self._state.model_copy(
            update={
                **updates,
                "revision": self._state.revision + 1,
                "updated_at": now or datetime.now(UTC),
            }
        )
        self._store.save(next_state)
        self._state = next_state
        return self._state
