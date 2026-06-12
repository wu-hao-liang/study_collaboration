from pytest import CaptureFixture

from backend.app.cli import _print_ascii_qr


def test_ascii_qr_is_safe_for_windows_code_pages(capsys: CaptureFixture[str]) -> None:
    _print_ascii_qr("http://127.0.0.1:8000/control/example")

    output = capsys.readouterr().out
    assert output
    output.encode("ascii")
    assert "##" in output
