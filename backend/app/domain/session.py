from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Final, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.domain.money import MAX_PRICE_CENTS

SCHEMA_VERSION: Final[Literal[1]] = 1
CONTROL_TOKEN_BYTES = 32


class ActivePanel(StrEnum):
    SUMMARY = "summary"
    DETAILS = "details"


class SpeechPhase(StrEnum):
    IDLE = "idle"
    LISTENING = "listening"
    REVIEWING = "reviewing"
    COMMITTING = "committing"
    ERROR = "error"


class SpeechTarget(StrEnum):
    SEARCH = "search"
    PRICE = "price"


PriceCents = Annotated[int, Field(ge=0, le=MAX_PRICE_CENTS)]


class GestureState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    enabled: bool = False
    last_accepted_at: datetime | None = None


class SpeechState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    phase: SpeechPhase = SpeechPhase.IDLE
    target: SpeechTarget = SpeechTarget.SEARCH
    draft: str = ""
    deadline: datetime | None = None
    error_code: str | None = None


class SessionState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = SCHEMA_VERSION
    session_id: UUID
    control_token_hash: str
    selected_product_id: str | None = None
    active_panel: ActivePanel = ActivePanel.SUMMARY
    prices: dict[str, PriceCents] = Field(default_factory=dict)
    gesture: GestureState = Field(default_factory=GestureState)
    speech: SpeechState = Field(default_factory=SpeechState)
    revision: int = Field(default=0, ge=0)
    started_at: datetime
    updated_at: datetime

    @field_validator("control_token_hash")
    @classmethod
    def validate_token_hash(cls, value: str) -> str:
        if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
            raise ValueError("控制令牌哈希必须是 SHA-256 十六进制字符串")
        return value

    @field_validator("started_at", "updated_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("时间必须包含时区")
        return value


class NewSession(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)

    state: SessionState
    control_token: str


def create_new_session(now: datetime | None = None) -> NewSession:
    timestamp = now or datetime.now(UTC)
    token = generate_control_token()
    state = SessionState(
        session_id=uuid4(),
        control_token_hash=hash_control_token(token),
        started_at=timestamp,
        updated_at=timestamp,
    )
    return NewSession(state=state, control_token=token)


def generate_control_token() -> str:
    return secrets.token_urlsafe(CONTROL_TOKEN_BYTES)


def hash_control_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
