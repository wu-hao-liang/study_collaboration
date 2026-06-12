import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.domain.products import Product
from backend.app.services.catalog import CatalogError, ProductCatalog


def _product(
    product_id: str,
    name: str,
    model: str,
    category: str = "三门",
) -> Product:
    return Product.model_validate(
        {
            "id": product_id,
            "category": category,
            "name": name,
            "model": model,
            "image": f"/assets/products/{product_id}.svg",
            "specs": [{"label": "总容积", "value": "300 L"}],
        }
    )


def test_product_rejects_duplicate_spec_labels() -> None:
    with pytest.raises(ValidationError, match="参数 label 不得重复"):
        Product.model_validate(
            {
                "id": "fridge-test",
                "category": "三门",
                "name": "测试冰箱",
                "model": "BCD-TEST",
                "image": "/assets/products/test.svg",
                "specs": [
                    {"label": "总容积", "value": "300 L"},
                    {"label": "总容积", "value": "301 L"},
                ],
            }
        )


def test_product_rejects_image_path_traversal() -> None:
    with pytest.raises(ValidationError, match="图片必须位于"):
        Product.model_validate(
            {
                "id": "fridge-test",
                "category": "三门",
                "name": "测试冰箱",
                "model": "BCD-TEST",
                "image": "/assets/products/../secret.svg",
                "specs": [{"label": "总容积", "value": "300 L"}],
            }
        )


def test_catalog_rejects_normalized_model_conflicts(tmp_path: Path) -> None:
    products = [
        _product("fridge-one", "冰箱一号", "BCD-100"),
        _product("fridge-two", "冰箱二号", "bcd-100"),
    ]

    with pytest.raises(CatalogError, match="model 冲突"):
        ProductCatalog(products, tmp_path)


def test_catalog_load_reports_field_validation(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(json.dumps([{"id": "bad id"}]), encoding="utf-8")

    with pytest.raises(CatalogError, match="产品目录无效"):
        ProductCatalog.load(catalog_path, tmp_path)


def test_missing_product_image_uses_local_placeholder(tmp_path: Path) -> None:
    product = _product("missing-image", "缺图冰箱", "BCD-MISSING")

    catalog = ProductCatalog([product], tmp_path)

    assert catalog.missing_images == ("missing-image",)
    assert catalog.products[0].image == "/assets/products/product-placeholder.svg"


def test_search_normalizes_and_sorts_by_match_quality(tmp_path: Path) -> None:
    catalog = ProductCatalog(
        [
            _product("one", "BCD 500 推荐款", "X-100", "对开门"),
            _product("two", "家庭冰箱", "BCD-500", "三门"),
            _product("three", "BCD-500", "OTHER", "法式多门"),
            _product("four", "大容量冰箱", "BCD-500-PRO", "十字对开门"),
        ],
        tmp_path,
    )

    results = catalog.search("  bcd－500  ")

    assert [product.id for product in results] == ["two", "three", "four"]
