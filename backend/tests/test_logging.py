import logging

from backend.app.services.logging import TokenRedactionFilter, redact_tokens


def test_token_query_values_are_redacted() -> None:
    assert (
        redact_tokens("/ws/control?token=super-secret&client_id=phone")
        == "/ws/control?token=[REDACTED]&client_id=phone"
    )


def test_logging_filter_redacts_message_and_arguments() -> None:
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request %s",
        args=("/api/control/validate?token=super-secret",),
        exc_info=None,
    )

    TokenRedactionFilter().filter(record)

    assert "super-secret" not in record.getMessage()
    assert "[REDACTED]" in record.getMessage()
