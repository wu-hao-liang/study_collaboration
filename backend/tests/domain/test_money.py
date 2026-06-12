import pytest

from backend.app.domain.money import MoneyParseError, parse_money


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [
        ("3999", 399_900),
        ("3999.00", 399_900),
        ("¥3999", 399_900),
        ("3999元", 399_900),
        ("3999块", 399_900),
        ("三千九百九十九", 399_900),
        ("三千九百九十九元", 399_900),
        ("十二", 1_200),
        ("一万二千三百四十五", 1_234_500),
        ("0", 0),
    ],
)
def test_parse_money_accepts_supported_formats(raw_value: str, expected: int) -> None:
    assert parse_money(raw_value) == expected


@pytest.mark.parametrize(
    "raw_value",
    ["", "-1", "便宜", "3999.999", "3999元500", "三三百"],
)
def test_parse_money_rejects_invalid_values(raw_value: str) -> None:
    with pytest.raises(MoneyParseError) as error:
        parse_money(raw_value)

    assert error.value.code == "INVALID_PRICE"


def test_parse_money_rejects_out_of_range_value() -> None:
    with pytest.raises(MoneyParseError) as error:
        parse_money("1000000")

    assert error.value.code == "PRICE_OUT_OF_RANGE"
