#!/usr/bin/env python3
"""Cut the 48 Pixel Octo stickers out of the sheet as clean, transparent pixel sprites.

Source is sheets/sheet_48_emotes.png, not the 256 px crops: the sheet is sharper and has
real alpha, while the crops are blurry, mis-framed and bleed into their neighbours
(docs/HARDWARE.md). The art has no consistent pixel grid (measured in Phase 1), so the
sprites are rebuilt on a fixed block size instead of a detected grid.

    .venv/bin/python tools/clean_emotes.py             # writes assets/emotes-clean/
    .venv/bin/python tools/clean_emotes.py --block 6   # chunkier pixels
"""
import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ORIG = ROOT / "assets" / "emotes-original"
SHEET = ORIG / "sheets" / "sheet_48_emotes.png"
OUT = ROOT / "assets" / "emotes-clean"
LEGEND_Y = 972  # the "Included in ZIP" bar at the bottom of the sheet starts below this
COLS = 8
RENAME = {17: "workout", 30: "raincoat", 37: "cloud"}  # crop names that don't match the art


def find_stickers(alpha, expected, cols=COLS, thr=200, pool=2):
    """Return [(bbox, mask)] per sticker in reading order (rows top to bottom, then left to right).

    With the soft glow (alpha < thr) cut away, each sticker plus its loose sparkles is one
    blob. Blobs are labelled on a pool x pool grid so the pure-Python flood fill stays fast."""
    h, w = alpha.shape[0] // pool, alpha.shape[1] // pool
    small = (alpha[:h * pool, :w * pool] >= thr).reshape(h, pool, w, pool).any(axis=(1, 3))
    labels = np.zeros((h, w), np.int32)
    n = 0
    for y, x in zip(*np.nonzero(small)):
        if labels[y, x]:
            continue
        n += 1
        labels[y, x] = n
        queue = deque([(y, x)])
        while queue:
            cy, cx = queue.popleft()
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = n
                    queue.append((ny, nx))
    if n != expected:
        raise SystemExit(f"found {n} sticker blobs, expected {expected}: try another --alpha")

    full = np.zeros(alpha.shape, np.int32)
    full[:h * pool, :w * pool] = labels.repeat(pool, 0).repeat(pool, 1)
    blobs = []
    for lab in range(1, n + 1):
        ys, xs = np.nonzero(full == lab)
        y0, x0, y1, x1 = ys.min(), xs.min(), ys.max() + 1, xs.max() + 1
        mask = (full[y0:y1, x0:x1] == lab) & (alpha[y0:y1, x0:x1] >= 128)
        blobs.append((ys.mean(), xs.mean(), (y0, x0, y1, x1), mask))

    blobs.sort(key=lambda b: b[0])
    rows = [sorted(blobs[i:i + cols], key=lambda b: b[1]) for i in range(0, n, cols)]
    for upper, lower in zip(rows, rows[1:]):
        if max(b[0] for b in upper) >= min(b[0] for b in lower):
            raise SystemExit("sticker rows overlap: the sheet is not a clean 8-column layout")
    return [(b[2], b[3]) for row in rows for b in row]


def strip_border(rgb, alpha, mask, steps):
    """Keep what is inside the white sticker border; drop the border and the background.

    Floods in from the outside through light pixels (the white border and its soft edge),
    8-connected, for at most `steps` px. Props with a dark outline (cat, chef hat, wings)
    stop the flood; the step limit protects white areas deep inside a sticker."""
    rgb = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
    alpha = np.pad(alpha, 1)
    gone = ~np.pad(mask, 1)  # the 1 px pad is "gone", so np.roll's wrap-around only moves pad into pad
    light = ((rgb.min(2) > 200) & (np.ptp(rgb, axis=2) < 40)) | (alpha < 245)
    for _ in range(steps):
        grow = gone.copy()
        for shift in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            grow |= np.roll(gone, shift, axis=(0, 1))
        gone |= grow & light
    return ~gone[1:-1, 1:-1]


def build_palette(pixels, colors):
    """One shared palette for every sprite, so the octo orange is identical everywhere.

    Octree, not median cut: median cut spends almost every slot on orange shades and turns
    small props grey (green battery, purple cloud, pink notes)."""
    return Image.fromarray(pixels.reshape(1, -1, 3)).quantize(colors, method=Image.Quantize.FASTOCTREE)


def merge_close(colours, usage, dist):
    """Index remap that folds near-identical shades into the more used one, so the body reads
    as flat colour instead of speckle while real shading tiers (dark side) stay separate."""
    remap = np.arange(len(colours))
    order = usage.argsort()[::-1]
    for n, i in enumerate(order):
        for j in order[:n]:
            if remap[j] == j and np.linalg.norm(colours[i].astype(int) - colours[j]) < dist:
                remap[i] = j
                break
    return remap


def pixelate(idx, keep, block):
    """Most common palette index per block x block cell; -1 where the cell is mostly empty."""
    ys, xs = np.nonzero(keep)
    idx = idx[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    keep = keep[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = -(-idx.shape[0] // block), -(-idx.shape[1] // block)
    out = np.full((h, w), -1, np.int32)
    for by in range(h):
        for bx in range(w):
            cell = np.s_[by * block:(by + 1) * block, bx * block:(bx + 1) * block]
            if keep[cell].mean() > 0.5:
                out[by, bx] = np.bincount(idx[cell][keep[cell]]).argmax()
    return out


def to_rgba(grid, colours):
    rgba = np.zeros(grid.shape + (4,), np.uint8)
    on = grid >= 0
    rgba[on, :3] = colours[grid[on]]
    rgba[on, 3] = 255
    return Image.fromarray(rgba)


def contact_sheet(sprites, names, scale=4):
    """All sprites on a checkerboard (so transparency is visible), labelled for review."""
    cw = max(s.width for s in sprites) * scale + 16
    ch = max(s.height for s in sprites) * scale + 28
    rows = -(-len(sprites) // COLS)
    yy, xx = np.mgrid[:rows * ch, :COLS * cw]
    check = np.where(((yy // 8 + xx // 8) % 2)[..., None] == 0, 205, 235).astype(np.uint8)
    sheet = Image.fromarray(np.repeat(check, 3, axis=2)).convert("RGBA")
    draw = ImageDraw.Draw(sheet)
    for i, (sprite, name) in enumerate(zip(sprites, names)):
        x, y = (i % COLS) * cw, (i // COLS) * ch
        big = sprite.resize((sprite.width * scale, sprite.height * scale), Image.NEAREST)
        sheet.alpha_composite(big, (x + (cw - big.width) // 2, y + 4))
        draw.text((x + 6, y + ch - 20), name, fill=(20, 20, 20, 255))
    return sheet


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--block", type=int, default=5, help="sheet px per sprite pixel (octo pixels are ~10-11)")
    ap.add_argument("--colors", type=int, default=32, help="shared palette size")
    ap.add_argument("--merge", type=float, default=24, help="fold shades closer than this (RGB distance)")
    ap.add_argument("--alpha", type=int, default=200, help="alpha that separates stickers from the glow")
    ap.add_argument("--border", type=int, default=24, help="max white border thickness to peel, sheet px")
    args = ap.parse_args()

    names = [p.stem for p in sorted(ORIG.glob("[0-9][0-9]_*.png"))]
    names = [f"{n[:2]}_{RENAME[int(n[:2])]}" if int(n[:2]) in RENAME else n for n in names]
    sheet = np.asarray(Image.open(SHEET).convert("RGBA"))[:LEGEND_Y]
    rgb, alpha = sheet[..., :3], sheet[..., 3]

    crops = []
    for (y0, x0, y1, x1), mask in find_stickers(alpha, len(names), thr=args.alpha):
        c = np.ascontiguousarray(rgb[y0:y1, x0:x1])
        crops.append((c, strip_border(c, alpha[y0:y1, x0:x1], mask, args.border)))

    pal = build_palette(np.concatenate([c[k] for c, k in crops]), args.colors)
    colours = np.array(pal.getpalette()[:3 * args.colors], np.uint8).reshape(-1, 3)

    idxs = [np.asarray(Image.fromarray(c).quantize(palette=pal, dither=Image.Dither.NONE)) for c, _ in crops]
    usage = sum(np.bincount(i[k], minlength=len(colours)) for i, (_, k) in zip(idxs, crops))
    remap = merge_close(colours, usage, args.merge)

    OUT.mkdir(exist_ok=True)
    sprites, usage = [], np.zeros(len(colours), int)
    for name, idx, (_, keep) in zip(names, idxs, crops):
        grid = pixelate(remap[idx], keep, args.block)
        usage += np.bincount(grid[grid >= 0], minlength=len(colours))
        sprite = to_rgba(grid, colours)
        sprite.save(OUT / f"{name}.png")
        sprites.append(sprite)
    contact_sheet(sprites, names).save(OUT / "contact_sheet.png")

    sizes = sorted(s.size for s in sprites)
    print(f"{len(sprites)} sprites -> {OUT.relative_to(ROOT)}/ (sizes {sizes[0]} .. {sizes[-1]}), contact_sheet.png;"
          f" {int((usage > 0).sum())} colours used")
    print("most used colours:", ", ".join("#%02X%02X%02X" % tuple(colours[i]) for i in usage.argsort()[::-1][:6]))


if __name__ == "__main__":
    main()
