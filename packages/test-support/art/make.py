#!/usr/bin/env python3
"""Makes the generated half of the test art, and bakes outlines.js from it.

  python3 packages/test-support/art/make.py

Needs numpy, scipy, contourpy and Pillow. Writes:
 - olive/main.webp: the sample buddy's main image, from ../fixtures/sample.json.
 - derived/mint.webp: Pip recoloured.
 - test/parts.webp: Pip with a separate part within reach, which the cut line has to bridge.
 - test/hop.webp: Pip standing a little above the bottom of her picture.
 - test/soft.webp, test/far.webp: Pip blurred, and Pip with a small part out of reach.
 - outlines.js: the Python stand-in's cut lines for the images the Manager check bakes. The check
   compares its own loop count with these.

The bake follows the round-1 design's stand-in, step for step:
 1. Mask: alpha at 50% or more. Soft edges, glows and drop shadows fade out below that.
 2. Drop specks under 0.2% of the body.
 3. Separate parts within reach get a short bridge to the body. Parts further away than a third of
    the art keep their own line.
 4. Fill inner holes. Only the outer silhouette counts.
 5. Grow by the offset, 5 px at library size, measured from the art.
 6. Close narrow inlets and blur, so fur and pixels give a smooth cut.
 7. Trace the contour, and store it as a path plus its length.
"""
import base64, io, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ni
import contourpy

HERE = Path(__file__).resolve().parent
OFFSET_CSS = 5.0      # gap from the art to the line, at library size
LIBRARY_H = 92        # the Manager's art height
STEP = 3.0            # distance between stored points, in art pixels

# key: (file, content height as a share of the canvas, buddy size)
BAKED = {
    'olive': ('olive/main.webp', 1.0, 120),
    'pip': ('pip/main.webp', 1.0, 120),
    'pudding': ('pudding/main.webp', 1.0, 110),
    'tower': ('derived/tower.webp', 1.0, 170),
    'loaf': ('derived/loaf.webp', .504, 96),
    'test-parts': ('test/parts.webp', 1.0, 120),
    'test-soft': ('test/soft.webp', 1.0, 120),
    'test-far': ('test/far.webp', 1.0, 120),
}


def save(im, rel):
    im.save(HERE / rel, 'WEBP', lossless=True, method=6, exif=b'', icc_profile=None)


def make_art():
    sample = json.loads((HERE.parent / 'fixtures/sample.json').read_text())['buddy']
    data = base64.b64decode(sample['base']['src'].split(',', 1)[1])
    main = Image.open(io.BytesIO(data)).convert('RGBA')
    save(main.crop(main.getbbox()), 'olive/main.webp')

    pip = Image.open(HERE / 'pip/main.webp').convert('RGBA')
    r, g, b, a = pip.split()
    save(Image.merge('RGBA', (b, r, g, a)), 'derived/mint.webp')  # channels swapped: same shape, new colour

    parts = Image.new('RGBA', (pip.width + 70, pip.height), (0, 0, 0, 0))
    parts.paste(pip, (0, 0))
    d = ImageDraw.Draw(parts)
    x, y = pip.width + 22, 40  # a note beside her head, apart from her but within reach
    d.ellipse((x, y + 30, x + 26, y + 52), fill=(74, 58, 46, 255))
    d.rectangle((x + 20, y, x + 26, y + 42), fill=(74, 58, 46, 255))
    save(parts, 'test/parts.webp')

    stand = Image.open(HERE / 'pip/stand_1.webp').convert('RGBA')  # her feet off the bottom of the picture
    hop = Image.new('RGBA', (stand.width, stand.height + 14), (0, 0, 0, 0))
    hop.paste(stand, (0, 0))
    save(hop, 'test/hop.webp')

    soft = Image.new('RGBA', (pip.width + 60, pip.height + 60), (0, 0, 0, 0))  # her edges blurred away
    soft.paste(pip, (30, 30))
    soft.putalpha(soft.getchannel('A').filter(ImageFilter.GaussianBlur(9)))
    soft.save(HERE / 'test/soft.webp', 'WEBP', quality=88, method=6)
    small = pip.resize((pip.width // 4, pip.height // 4), Image.LANCZOS)  # a part out of reach
    far = Image.new('RGBA', (pip.width + 250, pip.height), (0, 0, 0, 0))
    far.paste(pip, (0, 0))
    far.paste(small, (far.width - small.width, 10))
    far.save(HERE / 'test/far.webp', 'WEBP', quality=88, method=6)


def bridge(mask, width):
    """Join parts to the biggest one with a capsule. Returns the mask and how many parts stayed apart."""
    lab, n = ni.label(mask, structure=np.ones((3, 3)))
    if n < 2:
        return mask, 0
    areas = ni.sum(mask, lab, range(1, n + 1))
    main = int(np.argmax(areas)) + 1
    reach = max(mask.shape) / 3
    out, apart = mask.copy(), 0
    dist, (iy, ix) = ni.distance_transform_edt(lab != main, return_indices=True)
    links = np.zeros_like(mask)
    for k in range(1, n + 1):
        if k == main:
            continue
        ys, xs = np.nonzero(lab == k)
        j = int(np.argmin(dist[ys, xs]))
        y, x = ys[j], xs[j]
        if dist[y, x] > reach:
            apart += 1
            continue
        for t in np.linspace(0, 1, int(dist[y, x]) + 2):
            links[int(y + (iy[y, x] - y) * t), int(x + (ix[y, x] - x) * t)] = True
    if links.any():
        out |= ni.distance_transform_edt(~links) <= width
    return out, apart


def outline(path, per_px):
    """path: an image. per_px: CSS pixels per art pixel at library size."""
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    off = OFFSET_CSS / per_px
    pad = int(off * 3 + 8)
    a = np.zeros((h + 2 * pad, w + 2 * pad))
    a[pad:pad + h, pad:pad + w] = np.asarray(img)[:, :, 3] / 255
    mask = a >= .5
    lab, n = ni.label(mask, structure=np.ones((3, 3)))
    if n > 1:
        areas = ni.sum(mask, lab, range(1, n + 1))
        keep = [i + 1 for i, v in enumerate(areas) if v >= .002 * areas.max()]
        mask = np.isin(lab, keep)
    mask, apart = bridge(mask, max(2, off * .35))
    mask = ni.binary_fill_holes(mask)
    grown = ni.distance_transform_edt(~mask) <= off
    r = off * 1.3
    far = ni.distance_transform_edt(~grown) <= r
    closed = ni.distance_transform_edt(far) > r
    closed = ni.binary_fill_holes(closed | grown)
    soft = ni.gaussian_filter(closed.astype(float), off * .45)
    loops = []
    for line in contourpy.contour_generator(z=soft).lines(.5):
        if len(line) < 12:
            continue
        p = line - pad
        seg = np.hypot(*np.diff(p, axis=0).T)
        s = np.concatenate([[0], np.cumsum(seg)])
        n_pts = max(12, int(s[-1] / STEP))
        t = np.linspace(0, s[-1], n_pts, endpoint=False)
        q = np.c_[np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])]
        d = 'M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in q) + 'Z'
        loops.append({'d': d.replace('.0 ', ' ').replace('.0L', 'L').replace('.0Z', 'Z'), 'len': round(float(s[-1]), 1)})
    return {'w': w, 'h': h, 'loops': loops}, apart


def main():
    make_art()
    out = {}
    for key, (file, fh, size) in BAKED.items():
        p = HERE / file
        per_px = fh * LIBRARY_H * size / 120 / Image.open(p).height
        out[key], apart = outline(p, per_px)
        print(f"{key:12} {out[key]['w']}x{out[key]['h']} loops {len(out[key]['loops'])} apart {apart}")
    (HERE / 'outlines.js').write_text('/* Generated by make.py. Each loop is a closed path in art pixels, and its length. */\nwindow.OUTLINES=' + json.dumps(out, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    main()
