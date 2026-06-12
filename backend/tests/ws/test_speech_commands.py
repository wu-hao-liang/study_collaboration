import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from backend.app.config import Settings
from backend.app.main import create_app


def _client(tmp_path: Path, review_ms: int = 20) -> TestClient:
    settings = Settings(
        data_dir=Path("data").resolve(),
        runtime_dir=tmp_path,
        dev_mode=False,
        speech_review_ms=review_ms,
    )
    return TestClient(create_app(settings))


def _command(
    command: str,
    payload: Mapping[str, object],
    revision: int,
) -> dict[str, object]:
    return {
        "type": "command",
        "request_id": str(uuid4()),
        "command": command,
        "payload": payload,
        "expected_revision": revision,
    }


def _receive_type(
    socket: WebSocketTestSession,
    event_type: str,
) -> dict[str, Any]:
    while True:
        message = socket.receive_json()
        if message["type"] == event_type:
            return cast(dict[str, Any], message)


def test_speech_auto_commit_uses_latest_edited_price(tmp_path: Path) -> None:
    client = _client(tmp_path, review_ms=30)

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        commands = [
            ("select_product", {"product_id": "fridge-haier-500"}),
            ("speech_set_target", {"target": "price"}),
            ("speech_started", {}),
            ("speech_interim", {"text": "3999"}),
            ("speech_stopped", {}),
            ("speech_edit_draft", {"text": "4299"}),
        ]
        revision = 0
        for name, payload in commands:
            studio.send_json(_command(name, payload, revision))
            state = _receive_type(studio, "state")
            ack = _receive_type(studio, "ack")
            revision = int(ack["revision"])
            assert int(state["revision"]) == revision

        committing = _receive_type(studio, "state")
        committed = _receive_type(studio, "state")

    assert committing["state"]["speech"]["phase"] == "committing"
    assert committed["state"]["speech"]["phase"] == "idle"
    assert committed["state"]["prices"]["fridge-haier-500"] == 429_900


def test_speech_cancel_prevents_deadline_commit(tmp_path: Path) -> None:
    client = _client(tmp_path, review_ms=20)

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        revision = 0
        for name, payload in [
            ("speech_started", {}),
            ("speech_stopped", {"text": "法式"}),
            ("speech_cancel", {}),
        ]:
            studio.send_json(_command(name, payload, revision))
            _receive_type(studio, "state")
            ack = _receive_type(studio, "ack")
            revision = int(ack["revision"])
        time.sleep(0.04)

    state = client.get("/api/bootstrap").json()["state"]
    assert state["speech"]["phase"] == "idle"
    assert state["revision"] == revision


def test_speech_confirm_commits_immediately(tmp_path: Path) -> None:
    client = _client(tmp_path, review_ms=5000)

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        studio.send_json(_command("speech_started", {}, 0))
        _receive_type(studio, "state")
        _receive_type(studio, "ack")
        studio.send_json(_command("speech_stopped", {"text": "对开门"}, 1))
        _receive_type(studio, "state")
        _receive_type(studio, "ack")
        studio.send_json(_command("speech_confirm", {}, 2))
        committing = _receive_type(studio, "state")
        committed = _receive_type(studio, "state")
        ack = _receive_type(studio, "ack")

    assert committing["state"]["speech"]["phase"] == "committing"
    assert committed["state"]["speech"]["phase"] == "idle"
    assert ack["ok"] is True
