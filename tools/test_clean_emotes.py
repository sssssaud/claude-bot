"""Self-check for clean_emotes: a fake sheet with known pixels must come back exactly.

    .venv/bin/python tools/test_clean_emotes.py
"""
import numpy as np
from PIL import Image

import clean_emotes as ce

ORANGE, DARK = (240, 120, 70), (30, 20, 20)
BLOCK, BORDER, GLOW = 5, 8, 4


def fake_sheet():
    """2x2 stickers: a 4x6-block orange body with one dark eye block, white border, soft glow.
    Each sticker's eye sits in a different column so the reading order is checkable."""
    sheet = np.zeros((200, 200, 4), np.uint8)
    bodies = {}
    for eye, (y, x) in enumerate([(20, 20), (20, 110), (110, 20), (110, 110)]):
        body = np.zeros((4, 6), int)
        body[1, eye] = 1
        bodies[eye] = body
        h, w = 4 * BLOCK + 2 * BORDER, 6 * BLOCK + 2 * BORDER
        sheet[y - GLOW:y + h + GLOW, x - GLOW:x + w + GLOW] = (255, 220, 220, 100)  # glow
        sheet[y:y + h, x:x + w] = (255, 255, 255, 252)                             # border
        px = np.array([ORANGE, DARK], np.uint8)[body.repeat(BLOCK, 0).repeat(BLOCK, 1)]
        sheet[y + BORDER:y + BORDER + 4 * BLOCK, x + BORDER:x + BORDER + 6 * BLOCK, :3] = px
    return sheet, [bodies[i] for i in range(4)]


def test_round_trip():
    sheet, bodies = fake_sheet()
    rgb, alpha = sheet[..., :3], sheet[..., 3]
    stickers = ce.find_stickers(alpha, 4, cols=2)
    assert len(stickers) == 4

    crops = []
    for (y0, x0, y1, x1), mask in stickers:
        c = np.ascontiguousarray(rgb[y0:y1, x0:x1])
        crops.append((c, ce.strip_border(c, alpha[y0:y1, x0:x1], mask, 16)))
    pal = ce.build_palette(np.concatenate([c[k] for c, k in crops]), 4)
    colours = np.array(pal.getpalette()[:12], np.uint8).reshape(-1, 3)

    for (c, keep), body in zip(crops, bodies):
        assert not (c[keep].min(1) > 200).any(), "white border pixels survived"
        grid = ce.pixelate(np.asarray(Image.fromarray(c).quantize(palette=pal, dither=Image.Dither.NONE)), keep, BLOCK)
        got = np.asarray(ce.to_rgba(grid, colours))
        want = np.dstack([np.array([ORANGE, DARK], np.uint8)[body], np.full(body.shape, 255, np.uint8)])
        assert got.shape == want.shape, (got.shape, want.shape)
        assert (got == want).all(), "sprite pixels or reading order differ"


def test_merge_close():
    colours = np.array([ORANGE, (244, 126, 76), DARK], np.uint8)  # 2nd is a near-twin of orange
    remap = ce.merge_close(colours, np.array([5, 10, 3]), 24)
    assert remap.tolist() == [1, 1, 2], remap  # folds into the more used twin, dark stays


if __name__ == "__main__":
    test_round_trip()
    test_merge_close()
    print("test_clean_emotes: OK")
