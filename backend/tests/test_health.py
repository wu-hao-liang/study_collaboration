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
