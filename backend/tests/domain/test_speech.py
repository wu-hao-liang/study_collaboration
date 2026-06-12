from datetime import UTC, datetime, timedelta
from pathlib import Path

from backend.app.domain.session import SpeechPhase, SpeechTarget
from backend.app.services.catalog import ProductCatalog
from backend.app.services.session import SessionService
from backend.app.storage.session_store import SessionStore

NOW = datetime(2026, 6, 11, 5, 0, tzinfo=UTC)


def _service(tmp_path: Path) -> SessionService:
    catalog = ProductCatalog.load(Path("data/catalog.json"), Path("data/images"))
    return SessionService(catalog, SessionStore(tmp_path), NOW)


def test_speech_review_edit_preserves_deadline_and_search_commit(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.speech_started(0, NOW)
    service.speech_interim("法式", 1, NOW)
    reviewing = service.speech_stopped(None, 2, 3000, NOW)
    edited = service.speech_edit_draft("法式多门", 3, NOW + timedelta(seconds=1))

    assert reviewing.speech.phase is SpeechPhase.REVIEWING
    assert reviewing.speech.deadline == NOW + timedelta(seconds=3)
    assert edited.speech.deadline == reviewing.speech.deadline

    service.speech_begin_commit(4, NOW + timedelta(seconds=2))
    committed = service.speech_finish_commit(NOW + timedelta(seconds=2))

    assert committed.speech.phase is SpeechPhase.IDLE
    assert committed.speech.target is SpeechTarget.SEARCH
    assert committed.speech.draft == ""


def test_price_commit_uses_current_product_and_latest_draft(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.select_product("fridge-haier-500", 0, NOW)
    service.set_speech_target(SpeechTarget.PRICE, 1, NOW)
    service.speech_started(2, NOW)
    service.speech_interim("三千九百九十九", 3, NOW)
    service.speech_stopped(None, 4, 3000, NOW)
    service.speech_edit_draft("四千二百", 5, NOW + timedelta(seconds=1))
    service.speech_begin_commit(6, NOW + timedelta(seconds=2))
    committed = service.speech_finish_commit(NOW + timedelta(seconds=2))

    assert committed.prices["fridge-haier-500"] == 420_000
    assert committed.speech.phase is SpeechPhase.IDLE


def test_empty_and_invalid_price_never_replace_current_value(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.select_product("fridge-haier-500", 0, NOW)
    service.set_price("fridge-haier-500", "3999", 1, NOW)
    service.set_speech_target(SpeechTarget.PRICE, 2, NOW)
    service.speech_started(3, NOW)
    empty = service.speech_stopped("", 4, 3000, NOW)

    assert empty.speech.phase is SpeechPhase.ERROR
    assert empty.speech.error_code == "EMPTY_SPEECH"

    service.speech_cancel(5, NOW)
    service.speech_started(6, NOW)
    service.speech_stopped("便宜一点", 7, 3000, NOW)
    service.speech_begin_commit(8, NOW)
    invalid = service.speech_finish_commit(NOW)

    assert invalid.speech.phase is SpeechPhase.ERROR
    assert invalid.speech.error_code == "INVALID_PRICE"
    assert invalid.prices["fridge-haier-500"] == 399_900


def test_new_listening_and_cancel_clear_previous_review(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.speech_started(0, NOW)
    service.speech_stopped("海尔", 1, 3000, NOW)
    restarted = service.speech_started(2, NOW + timedelta(seconds=1))
    cancelled = service.speech_cancel(3, NOW + timedelta(seconds=2))

    assert restarted.speech.phase is SpeechPhase.LISTENING
    assert restarted.speech.deadline is None
    assert restarted.speech.draft == ""
    assert cancelled.speech.phase is SpeechPhase.IDLE
