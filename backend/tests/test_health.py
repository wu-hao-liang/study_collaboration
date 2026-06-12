from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_health_endpoint_returns_basic_status() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service"] == "live-background"
    assert body["checks"]["catalog_products"] == 6
    assert body["checks"]["missing_images"] == []


def test_built_frontend_routes_are_served() -> None:
    client = TestClient(create_app())

    studio = client.get("/studio")
    control = client.get("/control/example-token")

    assert studio.status_code == 200
    assert control.status_code == 200
    assert "text/html" in studio.headers["content-type"]
