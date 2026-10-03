"""Light radar mark for the Windows taskbar and installer. Stdlib only."""
import struct
import zlib
from pathlib import Path

W = 256


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(size: int, rows: list[bytes]) -> bytes:
    raw = b"".join(b"\x00" + row for row in rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def ico(png_bytes: bytes) -> bytes:
    # Width and height bytes of 0 mean 256.
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png_bytes), 6 + 16)
    return header + entry + png_bytes


def pixel(x: int, y: int) -> bytes:
    cx = cy = (W - 1) / 2
    dx, dy = x - cx, y - cy
    r = (dx * dx + dy * dy) ** 0.5
    # Soft rounded square on a light field.
    ax, ay = abs(dx), abs(dy)
    outside = max(ax, ay) > W * 0.46
    if outside:
        return b"\x00\x00\x00\x00"
    bg = (245, 247, 250, 255)
    ring = (10, 115, 148, 255)
    for radius, width in ((118, 7), (78, 6), (40, 6)):
        if abs(r - radius) <= width / 2:
            return bytes(ring)
    if r <= 10:
        return bytes(ring)
    return bytes(bg)


def main() -> None:
    rows = [b"".join(pixel(x, y) for x in range(W)) for y in range(W)]
    image = png(W, rows)
    out = Path(__file__).resolve().parent
    (out / "icon.png").write_bytes(image)
    (out / "icon.ico").write_bytes(ico(image))
    print(f"wrote {out / 'icon.png'} and {out / 'icon.ico'}")


if __name__ == "__main__":
    main()
