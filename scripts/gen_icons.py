import struct
import zlib
import os

BG = (10, 22, 40)       # #0a1628
ACCENT = (255, 68, 68)  # #ff4444


def make_png(path, size):
    cx = cy = size / 2
    r = size * 0.30
    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)  # no filter
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            if dist <= r:
                px = ACCENT
            else:
                px = BG
            row.extend(px)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    base = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
    make_png(os.path.join(base, "icon-192x192.png"), 192)
    make_png(os.path.join(base, "icon-512x512.png"), 512)
