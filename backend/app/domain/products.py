from __future__ import annotations

import re
from pathlib import PurePosixPath

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PRODUCT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class ProductSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str
    value: str

    @field_validator("label", "value")
    @classmethod
    def strip_nonempty_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("字段不能为空")
        return stripped


class Product(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    category: str
    name: str
    model: str
    image: str
    specs: list[ProductSpec] = Field(min_length=1)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if PRODUCT_ID_PATTERN.fullmatch(value) is None:
            raise ValueError("产品 ID 必须是 1 到 64 位 URL 安全字符")
        return value

    @field_validator("category", "name", "model")
    @classmethod
    def strip_nonempty_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("字段不能为空")
        return stripped

    @field_validator("image")
    @classmethod
    def validate_image_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        if (
            not value.startswith("/assets/products/")
            or ".." in path.parts
            or path.name in {"", ".", ".."}
        ):
            raise ValueError("图片必须位于 /assets/products/ 下")
        return value

    @model_validator(mode="after")
    def validate_unique_spec_labels(self) -> Product:
        labels = [spec.label.casefold() for spec in self.specs]
        if len(labels) != len(set(labels)):
            raise ValueError("参数 label 不得重复")
        return self
