from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backend.app.domain.session import ActivePanel, SpeechTarget, hash_control_token
from backend.app.services.catalog import ProductCatalog
from backend.app.services.session import SessionCommandError, SessionService
from backend.app.storage.session_store import SessionStorageError, SessionStore

NOW = datetime(2026, 6, 11, 2, 30, tzinfo=UTC)


def _catalog() -> ProductCatalog:
    return ProductCatalog.load(Path("data/catalog.json"), Path("data/images"))


def _service(tmp_path: Path) -> SessionService:
    return SessionService(_catalog(), SessionStore(tmp_path), NOW)


def test_new_session_has_safe_defaults_and_persisted_token_hash(tmp_path: Path) -> None:
    service = _service(tmp_path)

    assert service.state.revision == 0
    assert service.state.selected_product_id is None
    assert service.state.active_panel is ActivePanel.SUMMARY
    assert service.state.prices == {}
    assert service.control_token is not None
    assert hash_control_token(service.control_token) == service.state.control_token_hash

    persisted = (tmp_path / "session.json").read_text(encoding="utf-8")
    assert service.control_token not in persisted


def test_persistent_commands_increment_revision_once_and_noop_does_not(tmp_path: Path) -> None:
    service = _service(tmp_path)

    selected = service.select_product("fridge-haier-500", 0, NOW + timedelta(seconds=1))
    unchanged = service.select_product("fridge-haier-500", 1, NOW + timedelta(seconds=2))
    detailed = service.set_panel(ActivePanel.DETAILS, 1, NOW + timedelta(seconds=3))

    assert selected.revision == 1
    assert unchanged.revision == 1
    assert detailed.revision == 2
    assert detailed.selected_product_id == "fridge-haier-500"


def test_prices_are_stored_per_product_and_survive_product_switch(tmp_path: Path) -> None:
    service = _service(tmp_path)

    service.set_price("fridge-haier-500", "3999元", 0)
    service.select_product("fridge-midea-508", 1)
    state = service.set_price("fridge-midea-508", "4999", 2)

    assert state.prices == {
        "fridge-haier-500": 399_900,
        "fridge-midea-508": 499_900,
    }


def test_restart_recovers_unfinished_session_without_plaintext_token(tmp_path: Path) -> None:
    first = _service(tmp_path)
    first.select_product("fridge-haier-500", 0)
    first.set_price("fridge-haier-500", "3999", 1)

    restored = SessionService(_catalog(), SessionStore(tmp_path), NOW + timedelta(minutes=1))

    assert restored.state.session_id == first.state.session_id
    assert restored.state.selected_product_id == "fridge-haier-500"
    assert restored.state.prices["fridge-haier-500"] == 399_900
    assert restored.control_token is None


def test_stale_revision_and_invalid_product_leave_state_unchanged(tmp_path: Path) -> None:
    service = _service(tmp_path)
    original = service.state

    with pytest.raises(SessionCommandError) as revision_error:
        service.set_panel(ActivePanel.DETAILS, 99)
    with pytest.raises(SessionCommandError) as product_error:
        service.select_product("missing", 0)

    assert revision_error.value.code == "REVISION_CONFLICT"
    assert product_error.value.code == "PRODUCT_NOT_FOUND"
    assert service.state == original


def test_invalid_price_does_not_replace_existing_value(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.set_price("fridge-haier-500", "3999", 0)

    with pytest.raises(SessionCommandError) as error:
        service.set_price("fridge-haier-500", "便宜", 1)

    assert error.value.code == "INVALID_PRICE"
    assert service.state.prices["fridge-haier-500"] == 399_900
    assert service.state.revision == 1


def test_storage_failure_does_not_publish_new_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path)
    original = service.state

    def fail_save(_state: object) -> None:
        raise SessionStorageError("disk full")

    monkeypatch.setattr(service._store, "save", fail_save)

    with pytest.raises(SessionStorageError):
        service.set_gesture_enabled(True, 0)

    assert service.state == original


def test_end_session_clears_transient_state_and_rotates_identity(tmp_path: Path) -> None:
    service = _service(tmp_path)
    old_session_id = service.state.session_id
    old_hash = service.state.control_token_hash
    service.select_product("fridge-haier-500", 0)
    service.set_price("fridge-haier-500", "3999", 1)
    service.set_panel(ActivePanel.DETAILS, 2)
    service.set_gesture_enabled(True, 3)
    service.set_speech_target(SpeechTarget.PRICE, 4)

    state = service.end_session(5, NOW + timedelta(hours=1))

    assert state.session_id != old_session_id
    assert state.control_token_hash != old_hash
    assert state.selected_product_id is None
    assert state.prices == {}
    assert state.active_panel is ActivePanel.SUMMARY
    assert state.gesture.enabled is False
    assert state.speech.target is SpeechTarget.SEARCH
    assert state.revision == 0
    assert service.control_token is not None


def test_failed_end_session_keeps_existing_identity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path)
    original_state = service.state
    original_token = service.control_token

    def fail_save(_state: object) -> None:
        raise SessionStorageError("disk full")

    monkeypatch.setattr(service._store, "save", fail_save)

    with pytest.raises(SessionStorageError):
        service.end_session(0)

    assert service.state == original_state
    assert service.control_token == original_token
