from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CommandEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["command"]
    request_id: UUID
    command: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    expected_revision: int | None = Field(default=None, ge=0)


class PongEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["pong"]
