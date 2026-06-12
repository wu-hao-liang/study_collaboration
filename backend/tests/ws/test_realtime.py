from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import backend.app.api.websockets as websocket_api
from backend.app.config import Settings
from backend.app.main import create_app


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        data_dir=Path("data").resolve(),
        runtime_dir=tmp_path,
        dev_mode=False,
    )
    return TestClient(create_app(settings))


def _command(
    command: str,
    payload: dict[str, object],
    revision: int | None,
    request_id: str | None = None,
) -> dict[str, object]:
    message: dict[str, object] = {
        "type": "command",
        "request_id": request_id or str(uuid4()),
        "command": command,
        "payload": payload,
    }
    if revision is not None:
        message["expected_revision"] = revision
    return message


def test_studio_gets_snapshot_and_persisted_state_broadcast(tmp_path: Path) -> None:
    client = _client(tmp_path)

    with client.websocket_connect("/ws/studio") as studio:
        initial = studio.receive_json()
        studio.send_json(_command("select_product", {"product_id": "fridge-haier-500"}, 0))
        state = studio.receive_json()
        ack = studio.receive_json()

    assert initial["type"] == "state"
    assert "control_token_hash" not in initial["state"]
    assert state["state"]["selected_product_id"] == "fridge-haier-500"
    assert state["revision"] == 1
    assert ack["ok"] is True
    assert ack["revision"] == 1


def test_revision_conflict_returns_latest_redacted_state(tmp_path: Path) -> None:
    client = _client(tmp_path)

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        studio.send_json(_command("set_panel", {"panel": "details"}, 0))
        studio.receive_json()
        studio.receive_json()
        studio.send_json(_command("set_panel", {"panel": "summary"}, 0))
        conflict = studio.receive_json()

    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "REVISION_CONFLICT"
    assert conflict["error"]["details"]["state"]["active_panel"] == "details"
    assert "control_token_hash" not in conflict["error"]["details"]["state"]


def test_duplicate_request_id_does_not_apply_command_twice(tmp_path: Path) -> None:
    client = _client(tmp_path)
    request_id = str(uuid4())
    command = _command(
        "set_price",
        {"product_id": "fridge-haier-500", "raw_value": "3999"},
        0,
        request_id,
    )

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        studio.send_json(command)
        studio.receive_json()
        first_ack = studio.receive_json()
        studio.send_json(command)
        second_ack = studio.receive_json()

    assert second_ack == first_ack
    assert client.get("/api/bootstrap").json()["state"]["revision"] == 1


def test_setting_current_product_price_broadcasts_highlight_after_state(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        studio.send_json(_command("select_product", {"product_id": "fridge-haier-500"}, 0))
        studio.receive_json()
        studio.receive_json()
        studio.send_json(
            _command(
                "set_price",
                {"product_id": "fridge-haier-500", "raw_value": "3999"},
                1,
            )
        )
        state_message = studio.receive_json()
        animation_message = studio.receive_json()
        ack = studio.receive_json()

    assert state_message["type"] == "state"
    assert state_message["state"]["prices"]["fridge-haier-500"] == 399_900
    assert animation_message["type"] == "animation"
    assert animation_message["name"] == "price_highlight"
    assert animation_message["product_id"] == "fridge-haier-500"
    assert ack["ok"] is True


def test_new_studio_replaces_previous_connection(tmp_path: Path) -> None:
    client = _client(tmp_path)

    with client.websocket_connect("/ws/studio") as first:
        first.receive_json()
        with client.websocket_connect("/ws/studio") as second:
            second.receive_json()
            with pytest.raises(WebSocketDisconnect) as closed:
                first.receive_json()

    assert closed.value.code == 4001


def test_second_phone_is_rejected_while_slot_is_active(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as first:
        first.receive_json()
        assert (
            client.get(
                "/api/control/validate",
                params={"token": token},
            ).json()["slot"]
            == "occupied"
        )
        with (
            pytest.raises(WebSocketDisconnect) as occupied,
            client.websocket_connect(f"/ws/control?token={token}&client_id=phone-b") as second,
        ):
            second.receive_json()

    assert occupied.value.code == 4009


def test_invalid_phone_token_is_rejected(tmp_path: Path) -> None:
    client = _client(tmp_path)

    with (
        pytest.raises(WebSocketDisconnect) as invalid,
        client.websocket_connect("/ws/control?token=wrong&client_id=phone-a") as phone,
    ):
        phone.receive_json()

    assert invalid.value.code == 4003


def test_original_phone_reconnects_during_grace_and_gets_full_state(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as first:
        first.receive_json()
        first.send_json(_command("select_product", {"product_id": "fridge-midea-508"}, 0))
        first.receive_json()
        first.receive_json()
        first.close(code=1011)

    with (
        pytest.raises(WebSocketDisconnect) as occupied,
        client.websocket_connect(f"/ws/control?token={token}&client_id=phone-b") as other,
    ):
        other.receive_json()

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as restored:
        snapshot = restored.receive_json()

    assert occupied.value.code == 4009
    assert snapshot["state"]["selected_product_id"] == "fridge-midea-508"
    assert snapshot["revision"] == 1


def test_mobile_cannot_end_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as phone:
        phone.receive_json()
        phone.send_json(_command("end_session", {}, 0))
        ack = phone.receive_json()

    assert ack["ok"] is False
    assert ack["error"]["code"] == "COMMAND_FORBIDDEN"


def test_end_session_disconnects_phone_and_invalidates_old_token(tmp_path: Path) -> None:
    client = _client(tmp_path)
    token = client.post("/api/control-token").json()["token"]

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        with client.websocket_connect(f"/ws/control?token={token}&client_id=phone-a") as phone:
            phone.receive_json()
            studio.send_json(_command("end_session", {}, 0))
            studio_state = studio.receive_json()
            studio_ack = studio.receive_json()
            phone_state = phone.receive_json()
            with pytest.raises(WebSocketDisconnect) as closed:
                phone.receive_json()

    assert studio_state["state"]["prices"] == {}
    assert studio_ack["ok"] is True
    assert phone_state["state"]["session_id"] == studio_state["state"]["session_id"]
    assert closed.value.code == 4003
    assert (
        client.get(
            "/api/control/validate",
            params={"token": token},
        ).json()["valid"]
        is False
    )


def test_animation_is_transient_and_duplicate_request_is_not_replayed(tmp_path: Path) -> None:
    client = _client(tmp_path)
    request_id = str(uuid4())
    command = _command(
        "trigger_animation",
        {"name": "product_spotlight"},
        None,
        request_id,
    )

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        studio.send_json(command)
        animation = studio.receive_json()
        first_ack = studio.receive_json()
        studio.send_json(command)
        duplicate_ack = studio.receive_json()

    assert animation["type"] == "animation"
    assert animation["name"] == "product_spotlight"
    assert first_ack == duplicate_ack
    assert client.get("/api/bootstrap").json()["state"]["revision"] == 0


def test_idle_connection_receives_ping_and_pong_keeps_it_usable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(websocket_api, "PING_INTERVAL_SECONDS", 0.05)
    monkeypatch.setattr(websocket_api, "CLIENT_TIMEOUT_SECONDS", 1.0)
    client = _client(tmp_path)

    with client.websocket_connect("/ws/studio") as studio:
        studio.receive_json()
        ping = studio.receive_json()
        studio.send_json({"type": "pong"})
        studio.send_json(_command("set_panel", {"panel": "details"}, 0))
        state = None
        ack = None
        while state is None or ack is None:
            message = studio.receive_json()
            if message["type"] == "ping":
                studio.send_json({"type": "pong"})
            elif message["type"] == "state":
                state = message
            elif message["type"] == "ack":
                ack = message

    assert ping == {"type": "ping"}
    assert state is not None
    assert ack is not None
    assert state["state"]["active_panel"] == "details"
    assert ack["ok"] is True
