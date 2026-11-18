"""Shrinks and prepares the kit textures copied by build-bodies.mjs (src/assets/kit/textures).

Hair and shoes become greyscale (alpha kept) so the game can tint them to any
colour; everything is resized to 512 px. Needs Pillow. Run after build-bodies.mjs.
"""
import os, sys
from PIL import Image

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets', 'kit', 'textures')
for name in sorted(os.listdir(DIR)):
    path = os.path.join(DIR, name)
    im = Image.open(path)
    if im.mode == 'P':
        im = im.convert('RGBA')  # palette images keep their transparency this way
    im = im.resize((512, 512), Image.LANCZOS)
    tint = name.startswith('hair_') or name.startswith('outfit_shoes')
    if tint and not name.endswith('_normal.jpg'):
        alpha = im.getchannel('A') if 'A' in im.getbands() else None
        grey = im.convert('L')
        # stretch so the brightest fabric or hair is white: the tint colour then shows as chosen
        lo, hi = grey.getextrema()
        grey = grey.point(lambda v: int(255 * min(1, max(0, (v - lo * 0.3) / max(1, hi - lo * 0.3)))))
        im = Image.merge('LA', (grey, alpha)) if alpha else grey
    if name.endswith('.png'):
        im.save(path, optimize=True)
    else:
        im.convert('RGB').save(path, quality=85)
    print(name, os.path.getsize(path) // 1024, 'KB')
