import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from backend.app.domain.session import create_new_session
from backend.app.storage.session_store import (
    SessionStorageError,
    SessionStore,
    UnsupportedSessionSchema,
)

NOW = datetime(2026, 6, 11, 3, 0, tzinfo=UTC)
VALID_IDS = {"fridge-haier-500", "fridge-midea-508"}


def test_save_uses_replace_and_leaves_no_temp_file(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    state = create_new_session(NOW).state

    store.save(state)

    assert store.session_path.exists()
    assert not store.temp_path.exists()
    assert json.loads(store.session_path.read_text(encoding="utf-8"))["session_id"] == str(
        state.session_id
    )


def test_valid_state_is_restored(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    state = create_new_session(NOW).state.model_copy(
        update={
            "selected_product_id": "fridge-haier-500",
            "prices": {"fridge-haier-500": 399_900},
            "revision": 2,
        }
    )
    store.save(state)

    loaded = store.load_or_create(VALID_IDS, NOW)

    assert loaded.state == state
    assert loaded.control_token == ""


def test_corrupt_json_is_backed_up_and_replaced(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    store.session_path.write_text("{not-json", encoding="utf-8")

    loaded = store.load_or_create(VALID_IDS, NOW)

    backups = list(tmp_path.glob("session.corrupt-*.json"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{not-json"
    assert loaded.state.revision == 0
    assert store.session_path.exists()


def test_unknown_schema_version_fails_without_replacing_file(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    original = '{"schema_version": 99}'
    store.session_path.write_text(original, encoding="utf-8")

    with pytest.raises(UnsupportedSessionSchema, match="schema_version"):
        store.load_or_create(VALID_IDS, NOW)

    assert store.session_path.read_text(encoding="utf-8") == original
    assert list(tmp_path.glob("session.corrupt-*.json")) == []


def test_missing_schema_is_backed_up_as_invalid_state(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    store.session_path.write_text('{"revision": 1}', encoding="utf-8")

    loaded = store.load_or_create(VALID_IDS, NOW)

    assert loaded.state.revision == 0
    assert len(list(tmp_path.glob("session.corrupt-*.json"))) == 1


def test_removed_products_are_repaired_and_persisted(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    state = create_new_session(NOW).state.model_copy(
        update={
            "selected_product_id": "removed-product",
            "prices": {
                "removed-product": 100,
                "fridge-haier-500": 399_900,
            },
            "revision": 4,
        }
    )
    store.save(state)

    loaded = store.load_or_create(VALID_IDS, NOW)

    assert loaded.state.selected_product_id is None
    assert loaded.state.prices == {"fridge-haier-500": 399_900}
    assert loaded.state.revision == 5
    persisted = json.loads(store.session_path.read_text(encoding="utf-8"))
    assert persisted["revision"] == 5


def test_failed_replace_raises_stable_storage_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = SessionStore(tmp_path)

    def fail_replace(_source: Path, _destination: Path) -> None:
        raise OSError("disk failure")

    monkeypatch.setattr("backend.app.storage.session_store.os.replace", fail_replace)

    with pytest.raises(SessionStorageError, match="无法持久化"):
        store.save(create_new_session(NOW).state)

    assert not store.temp_path.exists()
    assert not store.session_path.exists()
