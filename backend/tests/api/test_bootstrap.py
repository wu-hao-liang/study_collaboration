from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


def _settings(runtime_dir: Path) -> Settings:
    return Settings(
        data_dir=Path("data").resolve(),
        runtime_dir=runtime_dir,
        dev_mode=False,
    )


def test_bootstrap_returns_catalog_and_redacted_state(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))

    response = client.get("/api/bootstrap")

    assert response.status_code == 200
    body = response.json()
    assert len(body["products"]) == 6
    assert body["config"]["ws_studio"] == "/ws/studio"
    assert "control_token_hash" not in body["state"]
    assert "token" not in response.text


def test_control_token_is_local_and_validates_without_echo(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))

    pairing = client.post("/api/control-token")
    token = pairing.json()["token"]
    validation = client.get("/api/control/validate", params={"token": token})
    invalid = client.get("/api/control/validate", params={"token": "wrong"})

    assert pairing.status_code == 200
    assert token in pairing.json()["phone_url"]
    assert validation.json() == {"valid": True, "slot": "available"}
    assert invalid.json() == {"valid": False, "slot": "invalid"}
    assert token not in validation.text


def test_control_token_rejects_non_local_request(tmp_path: Path) -> None:
    client = TestClient(
        create_app(_settings(tmp_path)),
        client=("192.168.1.50", 50000),
    )

    response = client.post("/api/control-token")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "COMMAND_FORBIDDEN"


def test_pairing_after_restart_rotates_unrecoverable_plaintext_token(tmp_path: Path) -> None:
    first_client = TestClient(create_app(_settings(tmp_path)))
    first_token = first_client.post("/api/control-token").json()["token"]

    restored_client = TestClient(create_app(_settings(tmp_path)))
    second_response = restored_client.post("/api/control-token")
    second_token = second_response.json()["token"]

    assert second_token != first_token
    assert (
        restored_client.get(
            "/api/control/validate",
            params={"token": first_token},
        ).json()["valid"]
        is False
    )
    assert second_response.status_code == 200
    assert restored_client.get("/api/bootstrap").json()["state"]["revision"] == 1
