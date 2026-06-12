from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

MAX_PRICE_CENTS = 99_999_999
ARABIC_AMOUNT = re.compile(r"^\d+(?:\.\d{1,2})?$")
CHINESE_AMOUNT = re.compile(r"^[零〇一二两三四五六七八九十百千万]+$")
PREFIX_PATTERN = re.compile(r"^(?:人民币|[¥￥])\s*")
SUFFIX_PATTERN = re.compile(r"\s*(?:元|块钱|块)$")

CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
SMALL_UNITS = {"十": 10, "百": 100, "千": 1000}


class MoneyParseError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def parse_money(raw_value: str) -> int:
    normalized = unicodedata.normalize("NFKC", raw_value).strip()
    normalized = PREFIX_PATTERN.sub("", normalized, count=1)
    normalized = SUFFIX_PATTERN.sub("", normalized, count=1).strip()

    if not normalized or "-" in normalized:
        raise MoneyParseError("INVALID_PRICE", "无法识别有效价格")

    if ARABIC_AMOUNT.fullmatch(normalized):
        try:
            cents_decimal = Decimal(normalized) * 100
        except InvalidOperation as exc:
            raise MoneyParseError("INVALID_PRICE", "无法识别有效价格") from exc
        cents = int(cents_decimal)
    elif CHINESE_AMOUNT.fullmatch(normalized):
        cents = _parse_chinese_integer(normalized) * 100
    else:
        raise MoneyParseError("INVALID_PRICE", "无法识别有效价格")

    if cents > MAX_PRICE_CENTS:
        raise MoneyParseError("PRICE_OUT_OF_RANGE", "价格超过允许的最大值")
    return cents


def _parse_chinese_integer(value: str) -> int:
    if not any(character in SMALL_UNITS or character == "万" for character in value):
        return int("".join(str(CHINESE_DIGITS[character]) for character in value))

    total = 0
    section = 0
    digit: int | None = None
    previous_was_digit = False

    for character in value:
        if character in CHINESE_DIGITS:
            if previous_was_digit and character not in {"零", "〇"}:
                raise MoneyParseError("INVALID_PRICE", "无法识别有效价格")
            digit = CHINESE_DIGITS[character]
            previous_was_digit = True
            continue

        previous_was_digit = False
        if character in SMALL_UNITS:
            unit = SMALL_UNITS[character]
            section += (1 if digit is None else digit) * unit
            digit = None
            continue

        if character == "万":
            section += 0 if digit is None else digit
            total += section * 10_000
            section = 0
            digit = None

    return total + section + (0 if digit is None else digit)
