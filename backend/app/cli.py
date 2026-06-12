import socket

import qrcode
import uvicorn

from backend.app.config import get_settings


def main() -> None:
    settings = get_settings()
    desktop_url = f"http://127.0.0.1:{settings.port}/studio"
    lan_host = _best_effort_lan_host()
    phone_url = f"http://{lan_host}:{settings.port}/control/pairing-pending"

    print("Live Background is starting")
    print(f"Desktop URL: {desktop_url}")
    print(f"Phone URL:   {phone_url}")
    _print_ascii_qr(phone_url)

    uvicorn.run(
        "backend.app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=settings.dev_mode,
    )


def _best_effort_lan_host() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"


def _print_ascii_qr(data: str) -> None:
    qr = qrcode.QRCode(border=1)
    qr.add_data(data)
    qr.make(fit=True)
    for row in qr.get_matrix():
        print("".join("##" if cell else "  " for cell in row))
