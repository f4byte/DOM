#!/usr/bin/env python3
"""Generate the PWA icon set (PNG) into web/public/icons. Run: npm run icons"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
BG = (79, 70, 229, 255)  # indigo-600
FG = (255, 255, 255, 255)
SS = 4  # supersampling for smooth edges


def render(size: int, *, maskable: bool) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)  # full-bleed; the OS applies its own mask
        scale = 0.46  # keep the glyph inside the 80% safe zone
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
        scale = 0.58
    # check-mark glyph
    w = s * scale
    ox = (s - w) / 2
    oy = (s - w) / 2
    pts = [(ox + w * 0.06, oy + w * 0.54), (ox + w * 0.40, oy + w * 0.88), (ox + w * 0.96, oy + w * 0.16)]
    stroke = int(w * 0.17)
    d.line(pts, fill=FG, width=stroke, joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=FG)
    return img.resize((size, size), Image.LANCZOS)


for name, size, mask in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),
]:
    render(size, maskable=mask).save(OUT / name)
    print("wrote", OUT / name)
