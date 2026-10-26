"""Builds the cropped photos and die-cut stickers used by the booklet.

Run from the repository root:  python3 tools/make_assets.py
Needs Pillow + numpy. Reads assets/images/sheets/*.jpg, writes assets/images/*.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "assets" / "images"
SHEETS = IMAGES / "sheets"

# Photo crops from the mannequin sheet (left, top, right, bottom).
# The two green-scribbled tiles on the right are left out on purpose.
PHOTO_CROPS = {
    "mannequin-front.jpg": (60, 0, 570, 1024),
    "mannequin-back.jpg": (590, 0, 1100, 1024),
    "closeup.jpg": (1160, 54, 1509, 338),
}

# Stickers from the illustration sheet: crop box + seed points inside the
# drawing we want (anything not connected to a seed, like the scribbles, is dropped).
STICKERS = {
    "sticker-bear.webp": ((40, 10, 640, 690), [(330, 200), (190, 520), (505, 600)]),
    "sticker-girl.webp": ((650, 55, 1465, 655), [(900, 300), (1365, 545)]),
    "sticker-yarn.webp": ((70, 680, 700, 990), [(190, 840), (480, 830)]),
    "sticker-ball.webp": ((1262, 462, 1465, 640), [(1365, 545)]),
}

OUTLINE = 9  # px of white die-cut border around each sticker


def foreground_mask(rgb):
    a = rgb.astype(int)
    lo, hi = a.min(axis=2), a.max(axis=2)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    ink = (lo < 228) | ((hi - lo) > 22)
    green = (g > r + 40) & (g > b + 15)  # the "don't use this" scribbles
    return Image.fromarray(((ink & ~green) * 255).astype(np.uint8), "L")


def keep_seeded(mask, seeds):
    """Keep only the connected blobs that contain one of the seed points."""
    work = mask.copy()
    for seed in seeds:
        if work.getpixel(seed) == 255:
            ImageDraw.floodfill(work, seed, 128)
    return work.point(lambda v: 255 if v == 128 else 0)


def fill_holes(mask):
    pad = 4
    w, h = mask.size
    framed = Image.new("L", (w + pad * 2, h + pad * 2), 0)
    framed.paste(mask, (pad, pad))
    ImageDraw.floodfill(framed, (0, 0), 100)  # everything reachable from outside
    filled = framed.point(lambda v: 0 if v == 100 else 255)
    return filled.crop((pad, pad, pad + w, pad + h))


def make_sticker(sheet, box, seeds, out):
    crop = sheet.crop(box)
    local = [(x - box[0], y - box[1]) for x, y in seeds]
    mask = foreground_mask(np.asarray(crop))
    # close tiny gaps in anti-aliased outlines so blobs stay in one piece
    mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3))
    mask = fill_holes(keep_seeded(mask, local))

    pad = OUTLINE + 6
    w, h = crop.size
    body = Image.new("L", (w + pad * 2, h + pad * 2), 0)
    body.paste(mask, (pad, pad))
    border = body.filter(ImageFilter.MaxFilter(OUTLINE * 2 + 1))
    border = border.filter(ImageFilter.GaussianBlur(1.2))

    canvas = Image.new("RGB", body.size, (255, 253, 248))
    canvas.paste(crop, (pad, pad), mask)
    rgba = canvas.convert("RGBA")
    rgba.putalpha(border)
    bbox = border.getbbox()
    rgba = rgba.crop(bbox)
    rgba.save(IMAGES / out, "WEBP", quality=88, method=6)
    print(f"{out}: {rgba.size}")


def main():
    mannequins = Image.open(SHEETS / "mannequins.jpg").convert("RGB")
    for name, box in PHOTO_CROPS.items():
        img = mannequins.crop(box)
        img.save(IMAGES / name, "JPEG", quality=88, optimize=True, progressive=True)
        print(f"{name}: {img.size}")

    stickers = Image.open(SHEETS / "stickers.jpg").convert("RGB")
    for name, (box, seeds) in STICKERS.items():
        make_sticker(stickers, box, seeds, name)


if __name__ == "__main__":
    main()
