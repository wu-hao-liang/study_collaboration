from typing import cast

from fastapi import APIRouter, Request

from backend.app.api.errors import ApiError
from backend.app.domain.products import Product
from backend.app.services.catalog import ProductCatalog

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("")
async def search_products(request: Request, q: str = "") -> dict[str, list[Product]]:
    catalog = _catalog(request)
    return {"products": catalog.search(q)}


@router.get("/{product_id}")
async def get_product(request: Request, product_id: str) -> Product:
    product = _catalog(request).get(product_id)
    if product is None:
        raise ApiError(404, "PRODUCT_NOT_FOUND", "未找到指定产品", {"product_id": product_id})
    return product


def _catalog(request: Request) -> ProductCatalog:
    return cast(ProductCatalog, request.app.state.catalog)
