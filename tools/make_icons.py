#!/usr/bin/env python3
"""Render the toolbar icons: a gold H on the extension's dark background.

Kept in the repo so the icons can be regenerated from source rather than being
opaque binaries nobody can edit. Run: python3 tools/make_icons.py
"""

import struct
import zlib
from pathlib import Path

BG = (0x14, 0x16, 0x1C)
FG = (0xC9, 0xA2, 0x27)
SIZES = (16, 32, 48, 128)
OUT = Path(__file__).resolve().parent.parent / "icons"


def glyph_pixels(size):
    """The H, as a predicate over pixel coordinates."""
    margin = max(2, round(size * 0.20))
    bar = max(2, round(size * 0.15))
    left, right = margin, size - margin
    top, bottom = margin, size - margin
    mid = size // 2

    def is_ink(x, y):
        if not (top <= y < bottom):
            return False
        if left <= x < left + bar or right - bar <= x < right:
            return True
        return left <= x < right and mid - bar // 2 <= y < mid - bar // 2 + bar

    return is_ink


def png(size):
    is_ink = glyph_pixels(size)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            raw.extend(FG if is_ink(x, y) else BG)
            raw.append(255)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main():
    OUT.mkdir(exist_ok=True)
    for size in SIZES:
        (OUT / f"icon{size}.png").write_bytes(png(size))
        print(f"icons/icon{size}.png")


if __name__ == "__main__":
    main()
