from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_search_products_returns_private_catalog_results() -> None:
    client = TestClient(create_app())

    response = client.get("/api/products", params={"q": "TCL"})

    assert response.status_code == 200
    products = response.json()["products"]
    assert [product["id"] for product in products] == ["fridge-tcl-256"]
    assert "price" not in products[0]


def test_get_product_returns_full_product() -> None:
    client = TestClient(create_app())

    response = client.get("/api/products/fridge-haier-500")

    assert response.status_code == 200
    assert response.json()["model"] == "BCD-500W"


def test_get_product_returns_stable_error_shape() -> None:
    client = TestClient(create_app())

    response = client.get("/api/products/not-found")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "PRODUCT_NOT_FOUND",
            "message": "未找到指定产品",
            "details": {"product_id": "not-found"},
        }
    }
