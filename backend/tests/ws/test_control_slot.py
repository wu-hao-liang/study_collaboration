from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app.config import Settings
from backend.app.main import create_app


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        data_dir=Path("data").resolve(),
        runtime_dir=tmp_path,
        dev_mode=False,
    )
    return TestClient(create_app(settings))


def _command(command: str, payload: dict[str, object], revision: int) -> dict[str, object]:
    return {
        "type": "command",
        "request_id": str(uuid4()),
        "command": command,
        "payload": payload,
        "expected_revision": revision,
    }


def test_second_phone_cannot_take_an_active_slot(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as first:
        first.receive_json()
        with (
            pytest.raises(WebSocketDisconnect) as occupied,
            client.websocket_connect(f"/ws/control?token={token}&client_id=phone-b") as second,
        ):
            second.receive_json()

    assert occupied.value.code == 4009


def test_original_phone_recovers_during_reconnect_grace(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as phone:
        phone.receive_json()
        phone.send_json(_command("select_product", {"product_id": "fridge-tcl-256"}, 0))
        phone.receive_json()
        phone.receive_json()
        phone.close(code=1011)

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as restored:
        snapshot = restored.receive_json()

    assert snapshot["state"]["selected_product_id"] == "fridge-tcl-256"
    assert snapshot["revision"] == 1


def test_normal_close_releases_slot_for_another_phone(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as phone:
        phone.receive_json()

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-b") as next_phone:
        snapshot = next_phone.receive_json()

    assert snapshot["type"] == "state"


def test_phone_cannot_end_the_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as phone:
        snapshot = phone.receive_json()
        phone.send_json(_command("end_session", {}, snapshot["revision"]))
        ack = phone.receive_json()

    assert ack["ok"] is False
    assert ack["error"]["code"] == "COMMAND_FORBIDDEN"
