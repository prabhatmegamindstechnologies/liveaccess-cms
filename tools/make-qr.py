"""Generate the website QR code.

    python tools/make-qr.py                      # production: writes app-qr.svg
    python tools/make-qr.py <url> <output.svg>   # testing: any URL, any file

Needs: pip install segno
"""
import ipaddress
import sys
from pathlib import Path
from urllib.parse import urlparse

import segno

# The one setting: what the website QR code opens. Store links are changed in download.html, not here.
DOWNLOAD_URL = "https://liveaccess.ai/download.html"

PRODUCTION_FILE = Path(__file__).resolve().parent.parent / "app-qr.svg"


def is_local(url):
    host = urlparse(url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else DOWNLOAD_URL
    out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else PRODUCTION_FILE

    if out == PRODUCTION_FILE and (is_local(url) or not url.startswith("https://")):
        sys.exit(f"Refusing to write {url} into app-qr.svg: the live site needs a public https URL. "
                 "Pass a different output file for local testing.")

    label = url.split("://", 1)[-1]
    # omitsize keeps only the viewBox, so the page's <img width/height> can scale it without blurring.
    segno.make_qr(url, error="m").save(str(out), kind="svg", scale=1, border=2, omitsize=True, xmldecl=False,
                                        dark="#101828", light="#fff", title=f"QR code: {label}")
    print(f"{out.name} -> {url}")


if __name__ == "__main__":
    main()
