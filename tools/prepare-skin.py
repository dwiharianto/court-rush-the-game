"""Builds the players' skin detail textures from MakeHuman's young skin textures (CC0).

The texture keeps the skin's detail (pores, lips, the flush of the cheeks, shading in the
creases) but not its base tone: each channel is divided by its average, so the player's
chosen skin colour sets the tone. Values are stored around 0.8 (linear) so the detail can
lighten as well as darken; the game scales skin colours by 1 / 0.8 to match.
Writes src/assets/kit/textures/skin_detail_male.jpg and skin_detail_female.jpg (1024 px).
Needs Pillow and the MakeHuman assets (tools/fetch-makehuman.sh). Run with -I.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '.cache', 'ara3d', 'package', 'assets', 'textures')
OUT = os.path.join(HERE, '..', 'src', 'assets', 'kit', 'textures')
MID = 0.8

def to_lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def to_srgb(c):
    c = max(0.0, min(1.0, c))
    return 255.0 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)

LIN = [to_lin(float(i)) for i in range(256)]

for gender in ('male', 'female'):
    im = Image.open(os.path.join(SRC, f'skin_young_caucasian_{gender}.jpg')).convert('RGB').resize((1024, 1024), Image.LANCZOS)
    px = im.load()
    w, h = im.size
    # average of the skin itself: ignore the dark background between the texture's islands
    sums, n = [0.0, 0.0, 0.0], 0
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            r, g, b = px[x, y]
            if r + g + b < 120:
                continue
            for c, v in enumerate((r, g, b)):
                sums[c] += LIN[v]
            n += 1
    mean = [s / n for s in sums]
    out = Image.new('RGB', (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            op[x, y] = tuple(int(round(to_srgb(MID * LIN[p[c]] / mean[c]))) for c in range(3))
    path = os.path.join(OUT, f'skin_detail_{gender}.jpg')
    out.save(path, quality=86)
    print(path, os.path.getsize(path) // 1024, 'KB, mean', [round(m, 3) for m in mean])
