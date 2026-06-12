from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables and .env."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    data_dir: Path = Path("data")
    runtime_dir: Path = Path("runtime")
    log_level: str = "info"
    dev_mode: bool = True
    gesture_cooldown_ms: int = Field(default=1500, ge=0)
    speech_review_ms: int = Field(default=3000, ge=0)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
