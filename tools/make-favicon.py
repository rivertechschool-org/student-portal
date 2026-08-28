"""Generate the River Tech site icons from the master logo.

    python tools/make-favicon.py

Writes favicon.ico (16/32/48) and apple-touch-icon.png (180) to the repo root.

WHY THIS IS NOT JUST A RESIZE
-----------------------------
The mark is a hairline gold double ring on transparency. Three things measured
on the real artwork, each of which breaks a naive pipeline:

1. Reduced to 16px, the strongest pixel of the mark comes back 44% opaque, and
   gold on a light Chrome tab is only 2.1:1 to begin with. Composited after the
   resize, the icon is invisible on a light browser theme. So the gold is
   flattened onto the dark plate BEFORE downscaling - the antialiasing then
   blends gold into dark instead of producing a translucent ghost.

2. The plate is the portal's own background, which sits at 1.56:1 against a dark
   Chrome tab strip - i.e. invisible there too. On dark themes the ring alone
   carries the mark, so the stroke has to survive the reduction. Straight
   downscaling left it at 1.68:1. Thickening the stroke first (in FINAL pixels,
   tapered off as the target size grows and the hairline starts surviving on its
   own) brings 16px to 6.1:1 while keeping the wordmark legible. Past ~0.45px of
   growth the two words blob together, so the taper is tuned, not maximal.

3. Resizing RGBA with transparent corners makes LANCZOS overshoot into the empty
   region and halo the edges - it produced pure white pixels in testing. So the
   art is built fully opaque, downscaled, and the rounded-corner mask is applied
   afterwards at final size.
"""
from PIL import Image, ImageDraw, ImageFilter
import glob, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.abspath(os.path.join(HERE, '..'))

pattern = os.path.join(os.path.expanduser('~'), 'Downloads', 'River Tech*logo*4000px*.png')
matches = glob.glob(pattern)
if not matches:
    sys.exit('Master logo not found. Expected something matching:\n  ' + pattern)
SRC = matches[0]

BG   = (15, 18, 22)      # --bg, the portal's own background
GOLD = (201, 169, 110)   # the mark's gold, held at full strength
SS   = 8                 # supersample factor before the final reduction

logo  = Image.open(SRC).convert('RGBA')
logo  = logo.crop(logo.getbbox())
ALPHA = logo.getchannel('A')   # the mark is one flat colour, so alpha IS the shape


def build(size, grow, inset, radius_frac, rounded=True):
    """grow: stroke thickening per side, expressed in FINAL pixels."""
    big   = size * SS
    inner = int(big * (1 - 2*inset))
    a = ALPHA.resize((inner, inner), Image.LANCZOS)

    r = int(round(grow * SS))
    while r > 0:                       # MaxFilter kernels must be odd and small
        step = min(r, 4)
        a = a.filter(ImageFilter.MaxFilter(step*2 + 1))
        r -= step

    plate = Image.new('RGB', (big, big), BG)
    plate.paste(Image.new('RGB', (inner, inner), GOLD), ((big-inner)//2,)*2, a)
    out = plate.resize((size, size), Image.LANCZOS).convert('RGBA')

    if rounded:
        m = Image.new('L', (big, big), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, big-1, big-1],
                                            radius=int(big*radius_frac), fill=255)
        out.putalpha(m.resize((size, size), Image.LANCZOS))
    return out


# size: (stroke growth in final px, inset, corner radius fraction)
TUNE = {
    16:  (0.30, 0.06, 0.20),
    32:  (0.18, 0.06, 0.20),
    48:  (0.12, 0.06, 0.20),
    180: (0.02, 0.10, None),   # apple-touch: iOS applies its own mask, so ship a
                               # full opaque square - pre-rounding double-rounds it
}
def icon(size):
    grow, inset, rf = TUNE[size]
    return build(size, grow, inset, rf or 0, rounded=rf is not None)


ico_sizes = [16, 32, 48]
imgs = {s: icon(s) for s in ico_sizes}
big  = max(ico_sizes)
# Pillow filters ICO sizes to those <= the BASE image, so the base must be the
# largest frame or every other size is silently dropped.
imgs[big].save(os.path.join(OUT, 'favicon.ico'), format='ICO',
               sizes=[(s, s) for s in ico_sizes],
               append_images=[imgs[s] for s in ico_sizes if s != big])

icon(180).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('wrote favicon.ico (16/32/48) and apple-touch-icon.png')
