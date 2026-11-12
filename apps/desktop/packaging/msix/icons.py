"""The Store package's icons, drawn from the app's own icon at every size the manifest names. Plain
Python, so it runs the same on any machine: a PNG reader for 8-bit RGB and RGBA, a tent filter in
premultiplied alpha, and a PNG writer. The pixels are the same everywhere; the compressed bytes can
differ with the zlib a Python was built with."""
import math
import struct
import zlib

SIG = b"\x89PNG\r\n\x1a\n"
SCALES = (100, 125, 150, 200, 400)
TARGETS = (16, 24, 32, 48, 256)
# Each image the manifest names: its file name, its size at scale 100, and how much of its shorter
# side the icon fills. Tiles keep a margin; the small ones are the icon edge to edge.
IMAGES = (
    ("Square44x44Logo", 44, 44, 1.0),
    ("Square71x71Logo", 71, 71, 0.6),
    ("Square150x150Logo", 150, 150, 0.6),
    ("Wide310x150Logo", 310, 150, 0.6),
    ("Square310x310Logo", 310, 310, 0.6),
    ("StoreLogo", 50, 50, 1.0),
)


def half_up(x):
    return int(math.floor(x + 0.5))


def plan():
    """Every file: (name, width, height, icon side)."""
    out = []
    for name, w, h, fill in IMAGES:
        for s in SCALES:
            W, H = half_up(w * s / 100), half_up(h * s / 100)
            out.append((f"{name}.scale-{s}.png", W, H, half_up(min(W, H) * fill)))
    for t in TARGETS:
        out.append((f"Square44x44Logo.targetsize-{t}.png", t, t, t))
        out.append((f"Square44x44Logo.targetsize-{t}_altform-unplated.png", t, t, t))
    return out


def read_png(data):
    """(width, height, RGBA bytes) from an 8-bit, non-interlaced RGB or RGBA PNG."""
    if data[:8] != SIG:
        raise ValueError("not a PNG")
    at, idat, head = 8, [], None
    while at < len(data):
        n, kind = struct.unpack_from(">I4s", data, at)
        body = data[at + 8:at + 8 + n]
        if kind == b"IHDR":
            head = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
        at += 12 + n
    if head is None:
        raise ValueError("no IHDR")
    w, h, depth, color, _, _, interlace = head
    if depth != 8 or color not in (2, 6) or interlace:
        raise ValueError(f"only 8-bit RGB or RGBA without interlacing, not depth {depth} color {color} interlace {interlace}")
    bpp = 4 if color == 6 else 3
    raw = zlib.decompress(b"".join(idat))
    stride = w * bpp
    prev = bytearray(stride)
    out = bytearray()
    for y in range(h):
        f = raw[y * (stride + 1)]
        row = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = row[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1:
                row[i] = (row[i] + a) & 255
            elif f == 2:
                row[i] = (row[i] + b) & 255
            elif f == 3:
                row[i] = (row[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            elif f != 0:
                raise ValueError(f"bad filter {f}")
        out += row if bpp == 4 else b"".join(bytes(row[i:i + 3]) + b"\xff" for i in range(0, stride, 3))
        prev = row
    return w, h, bytes(out)


def write_png(w, h, rgba):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    rows = b"".join(b"\0" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    return SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def taps(src, dst):
    """For each output pixel, its source pixels and their weights: a tent as wide as one output
    pixel when shrinking, one source pixel when growing."""
    scale = dst / src
    support = max(1.0, 1.0 / scale)
    out = []
    for i in range(dst):
        centre = (i + 0.5) / scale
        lo, hi = max(0, math.floor(centre - support)), min(src, math.ceil(centre + support))
        ws = [(j, 1.0 - abs(j + 0.5 - centre) / support) for j in range(lo, hi)]
        ws = [(j, x) for j, x in ws if x > 0]
        if not ws:
            ws = [(min(src - 1, max(0, int(centre))), 1.0)]
        total = sum(x for _, x in ws)
        out.append([(j, x / total) for j, x in ws])
    return out


def resize(w, h, rgba, side):
    """The image at side x side, which it must be square for."""
    if w != h:
        raise ValueError("the icon must be square")
    px = [0.0] * (w * h * 4)
    for i in range(w * h):
        a = rgba[i * 4 + 3] / 255
        px[i * 4:i * 4 + 4] = [rgba[i * 4] * a, rgba[i * 4 + 1] * a, rgba[i * 4 + 2] * a, a * 255]
    t = taps(w, side)
    across = [0.0] * (side * h * 4)
    for y in range(h):
        base = y * w * 4
        for x, ws in enumerate(t):
            r = g = b = a = 0.0
            for j, k in ws:
                p = base + j * 4
                r += px[p] * k; g += px[p + 1] * k; b += px[p + 2] * k; a += px[p + 3] * k
            o = (y * side + x) * 4
            across[o:o + 4] = (r, g, b, a)
    out = bytearray(side * side * 4)
    for y, ws in enumerate(t):
        for x in range(side):
            r = g = b = a = 0.0
            for j, k in ws:
                p = (j * side + x) * 4
                r += across[p] * k; g += across[p + 1] * k; b += across[p + 2] * k; a += across[p + 3] * k
            o = (y * side + x) * 4
            alpha = min(255, max(0, half_up(a)))
            if alpha:
                out[o:o + 4] = bytes(min(255, max(0, half_up(c * 255 / a))) for c in (r, g, b)) + bytes((alpha,))
    return bytes(out)


def place(W, H, side, icon):
    """A transparent W x H with the side x side icon in its middle."""
    out = bytearray(W * H * 4)
    left, top = (W - side) // 2, (H - side) // 2
    for y in range(side):
        o = ((top + y) * W + left) * 4
        out[o:o + side * 4] = icon[y * side * 4:(y + 1) * side * 4]
    return bytes(out)


def draw(icon_png):
    """{file name: PNG bytes} for every file in plan()."""
    w, h, rgba = read_png(icon_png)
    sized, out = {}, {}
    for name, W, H, side in plan():
        if side not in sized:
            sized[side] = resize(w, h, rgba, side)
        out[name] = write_png(W, H, place(W, H, side, sized[side]))
    return out
