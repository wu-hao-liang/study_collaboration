from __future__ import annotations

import json
import unicodedata
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from backend.app.domain.products import Product

PRODUCT_LIST_ADAPTER = TypeAdapter(list[Product])


class CatalogError(ValueError):
    """Raised when the version-controlled catalog is invalid."""


class ProductCatalog:
    def __init__(self, products: list[Product], image_dir: Path) -> None:
        resolved_products: list[Product] = []
        missing_images: list[str] = []
        for product in products:
            image_path = image_dir / PureProductImageName.from_url(product.image)
            if image_path.is_file():
                resolved_products.append(product)
                continue
            missing_images.append(product.id)
            resolved_products.append(
                product.model_copy(update={"image": "/assets/products/product-placeholder.svg"})
            )

        self._products = tuple(resolved_products)
        self._by_id = {product.id: product for product in resolved_products}
        self.missing_images = tuple(missing_images)
        self._validate_conflicts()

    @classmethod
    def load(cls, catalog_path: Path, image_dir: Path) -> ProductCatalog:
        try:
            raw_catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            products = PRODUCT_LIST_ADAPTER.validate_python(raw_catalog)
        except (OSError, json.JSONDecodeError, ValidationError) as exc:
            raise CatalogError(f"产品目录无效: {exc}") from exc
        if not products:
            raise CatalogError("产品目录无效: 至少需要一个产品")
        return cls(products, image_dir)

    @property
    def products(self) -> tuple[Product, ...]:
        return self._products

    def get(self, product_id: str) -> Product | None:
        return self._by_id.get(product_id)

    def search(self, query: str) -> list[Product]:
        normalized_query = normalize_search_text(query)
        if not normalized_query:
            return list(self._products)

        matches: list[tuple[int, int, Product]] = []
        for index, product in enumerate(self._products):
            model = normalize_search_text(product.model)
            name = normalize_search_text(product.name)
            category = normalize_search_text(product.category)
            if normalized_query not in f"{name}\n{model}\n{category}":
                continue
            if model == normalized_query:
                rank = 0
            elif name == normalized_query:
                rank = 1
            elif model.startswith(normalized_query):
                rank = 2
            else:
                rank = 3
            matches.append((rank, index, product))

        return [product for _, _, product in sorted(matches, key=lambda item: item[:2])]

    def _validate_conflicts(self) -> None:
        for field in ("id", "name", "model"):
            seen: dict[str, int] = {}
            for index, product in enumerate(self._products):
                value = normalize_search_text(getattr(product, field))
                if value in seen:
                    raise CatalogError(
                        f"产品目录无效: {field} 冲突，位于第 {seen[value] + 1} 和 {index + 1} 项"
                    )
                seen[value] = index


class PureProductImageName:
    @staticmethod
    def from_url(image_url: str) -> str:
        return image_url.removeprefix("/assets/products/")


def normalize_search_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()
