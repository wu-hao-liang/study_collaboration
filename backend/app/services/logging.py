from __future__ import annotations

import logging
import re
from typing import Any

TOKEN_QUERY = re.compile(r"(?i)(token=)[^&\s]+")


class TokenRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_tokens(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_redact_value(value) for value in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: _redact_value(value) for key, value in record.args.items()}
        return True


def install_token_redaction() -> None:
    for logger_name in ("uvicorn.access", "uvicorn.error", "live_background"):
        logger = logging.getLogger(logger_name)
        if not any(isinstance(item, TokenRedactionFilter) for item in logger.filters):
            logger.addFilter(TokenRedactionFilter())


def redact_tokens(value: str) -> str:
    return TOKEN_QUERY.sub(r"\1[REDACTED]", value)


def _redact_value(value: Any) -> Any:
    return redact_tokens(value) if isinstance(value, str) else value
