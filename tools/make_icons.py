#!/usr/bin/env python3
"""Genera los íconos de la PWA con la paleta del curso (tinta + verde)."""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

INK = (23, 33, 43)
GREEN = (47, 93, 80)
LINE = (170, 177, 181)
PAPER = (244, 246, 245)


def draw_icon(size, rounded):
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    s = size / 512
    # seis cuerdas verticales
    xs = [round((116 + i * 56) * s) for i in range(6)]
    for i, x in enumerate(xs):
        w = max(2, round((2 + i * 0.8) * s))
        d.rectangle([x - w // 2, round(90 * s), x + w // 2, round(422 * s)], fill=LINE)
    # cejuela
    d.rectangle([xs[0] - round(8 * s), round(84 * s), xs[-1] + round(8 * s), round(102 * s)], fill=PAPER)
    # trastes
    for y in (176, 258, 340):
        d.rectangle([xs[0], round(y * s), xs[-1], round((y + 5) * s)], fill=(90, 100, 108))
    # dedos (acorde estilizado)
    r = round(30 * s)
    for (cx, cy) in ((xs[1], 217), (xs[2], 299), (xs[4], 135)):
        cy = round(cy * s)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    if rounded:
        mask = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * 0.22), fill=255)
        base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        base.paste(img, (0, 0), mask)
        return base
    return img


draw_icon(512, False).save(OUT / "icon-512.png")
draw_icon(192, False).save(OUT / "icon-192.png")
draw_icon(180, False).save(OUT / "apple-touch-icon.png")
print("íconos generados en", OUT)
