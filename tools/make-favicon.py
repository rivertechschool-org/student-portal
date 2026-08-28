"""Generate the River Tech site icons from the master logo.

Two things this does that a plain resize does not, both measured rather than
assumed:

  1. Flattens gold onto the dark ground BEFORE downscaling. Resizing the
     transparent PNG first averages gold against nothing; at 16px the strongest
     pixel came back 44% opaque, which on a light browser tab is ~1.2:1
     contrast - an invisible favicon.

  2. Compensates the stroke weight per size. The mark is a hairline double ring;
     the more it is reduced the more the antialiasing thins it, so the alpha is
     boosted in proportion to the reduction. Without this the ring greys out and
     the wordmark dissolves into a smudge.
"""
from PIL import Image, ImageDraw
import glob, os

SRC = glob.glob(r'C:\Users\Jordan\Downloads\River Tech*logo*4000px*.png')[0]
OUT = r'D:\LLCWork\student-portal'
BG  = (15, 18, 22, 255)      # --bg, the portal's own background
SS  = 8                       # supersample before the final reduction

logo = Image.open(SRC).convert('RGBA')
logo = logo.crop(logo.getbbox())

def render(size, inset, boost, radius_frac):
    big = size * SS
    canvas = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ground = Image.new('RGBA', (big, big), BG)
    if radius_frac is None:                       # full-bleed square
        canvas = ground.copy()
    else:
        m = Image.new('L', (big, big), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, big-1, big-1],
                                            radius=int(big*radius_frac), fill=255)
        canvas.paste(ground, (0, 0), m)

    inner = int(big * (1 - 2*inset))
    mark = logo.resize((inner, inner), Image.LANCZOS)
    if boost != 1.0:
        r, g, b, a = mark.split()
        mark = Image.merge('RGBA', (r, g, b, a.point(lambda v: min(255, int(v*boost)))))
    o = (big - inner)//2
    canvas.alpha_composite(mark, (o, o))
    return canvas.resize((size, size), Image.LANCZOS)

# size: (inset, alpha boost, corner radius fraction)
TUNE = {
    16:  (0.05, 2.4,  0.20),
    32:  (0.05, 2.4,  0.20),
    48:  (0.06, 1.9,  0.20),
    64:  (0.07, 1.7,  0.20),
    128: (0.08, 1.35, 0.20),
    180: (0.10, 1.25, None),   # apple-touch: iOS applies its own mask, so ship
                               # a full square - pre-rounding double-rounds it
    512: (0.08, 1.0,  0.20),
}
def icon(size):
    return render(size, *TUNE[size])

# Pillow filters ICO sizes to those <= the BASE image, so the base must be the
# largest frame or the smaller-first ordering silently drops every other size.
ico_sizes = [16, 32, 48]
imgs = {s: icon(s) for s in ico_sizes}
base = imgs[max(ico_sizes)]
base.save(os.path.join(OUT, 'favicon.ico'), format='ICO',
          sizes=[(s, s) for s in ico_sizes],
          append_images=[imgs[s] for s in ico_sizes if s != max(ico_sizes)])

# Only what the pages actually reference. The .ico already carries a tuned 32px
# frame, and a 192/512 pair would be dead weight without a web manifest.
icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
print('wrote favicon.ico (16/32/48) and apple-touch-icon.png')
