#!/usr/bin/env python3
"""Regenerate resources/icon.png as a proper macOS "squircle" app icon.

macOS does NOT auto-round app icons: the artwork itself must be the rounded
superellipse (squircle) sitting inside transparent padding. This script takes
the raw brand art in scripts/icon-src.png, fits it into the standard macOS icon
grid, and masks it to a superellipse so the corners match the system shape.

Usage: python3 scripts/generate-icon.py
Then run scripts/build-icns.sh to regenerate resources/icon.icns.

Only dependency: Pillow (`python3 -m pip install pillow`).
"""

from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
SRC = HERE / "icon-src.png"
OUT = HERE.parent / "resources" / "icon.png"

SIZE = 1024          # master icon size
SUPERSAMPLE = 4      # render the mask big, then downsample for clean anti-aliasing
FOOTPRINT = 0.88     # squircle size when NOT full-bleed
EXPONENT = 3.0       # superellipse exponent — ~3 matches the rounded macOS squircle
LOGO_FRACTION = 0.62  # how much of the canvas the tree logo fills

# macOS 26 (Tahoe) masks app icons to its own shape and backs any transparent
# icon with a default light tile — which is why a padded squircle shows a grey
# frame in the Dock. Ship full-bleed, edge-to-edge opaque art and let the OS
# round it. Set False only for platforms that expect a pre-rounded icon.
FULL_BLEED = True


def squircle_mask(size: int, footprint: float, n: float) -> Image.Image:
    """Anti-aliased superellipse mask: |x|^n + |y|^n <= 1."""
    s = size * SUPERSAMPLE
    mask = Image.new("L", (s, s), 0)
    px = mask.load()
    r = footprint / 2.0 * s
    c = s / 2.0
    for y in range(s):
        yy = abs((y - c) / r)
        if yy >= 1:
            continue
        lim = (1 - yy**n) ** (1.0 / n)
        x0 = max(0, int(c - lim * r))
        x1 = min(s, int(c + lim * r))
        for x in range(x0, x1):
            px[x, y] = 255
    return mask.resize((size, size), Image.LANCZOS)


def logo_bbox(art: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of the *colorful* logo art (teal/orange), ignoring the flat
    navy background so we can size the logo — not the whole tile — to taste."""
    r, g, b, a = art.split()
    px = art.load()
    w, h = art.size
    mask = Image.new("L", (w, h), 0)
    mpx = mask.load()
    for y in range(h):
        for x in range(w):
            pr, pg, pb, pa = px[x, y]
            if pa < 24:
                continue
            chroma = max(pr, pg, pb) - min(pr, pg, pb)
            # Navy background is dark and low-chroma; the logo is saturated/bright.
            if chroma > 45 or max(pr, pg, pb) > 150:
                mpx[x, y] = 255
    return mask.getbbox()


def sample_navy(art: Image.Image) -> tuple[int, int, int, int]:
    """Flat navy background color, sampled from a corner inside the tile."""
    bbox = art.split()[3].getbbox()
    x = bbox[0] + int((bbox[2] - bbox[0]) * 0.08)
    y = bbox[1] + int((bbox[3] - bbox[1]) * 0.08)
    r, g, b, _ = art.getpixel((x, y))
    return (r, g, b, 255)


def main() -> None:
    art = Image.open(SRC).convert("RGBA")

    navy = sample_navy(art)
    lb = logo_bbox(art)
    logo = art.crop(lb)

    # Size the logo relative to the full canvas (full-bleed) or the inset squircle.
    reference = SIZE if FULL_BLEED else int(FOOTPRINT * SIZE)
    target = LOGO_FRACTION * reference
    scale = target / max(logo.width, logo.height)
    logo = logo.resize(
        (max(1, round(logo.width * scale)), max(1, round(logo.height * scale))),
        Image.LANCZOS,
    )

    # Solid navy tile, logo centered. The logo's own navy corners match the fill,
    # so the paste is seamless.
    canvas = Image.new("RGBA", (SIZE, SIZE), navy)
    canvas.paste(logo, ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2), logo)

    if FULL_BLEED:
        # Fully opaque edge-to-edge — macOS applies its own rounded mask.
        detail = "full-bleed"
    else:
        canvas.putalpha(squircle_mask(SIZE, FOOTPRINT, EXPONENT))
        detail = f"squircle n={EXPONENT} footprint={FOOTPRINT}"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT)
    print(f"wrote {OUT} ({SIZE}x{SIZE}, {detail}, logo={LOGO_FRACTION}, navy={navy[:3]})")


if __name__ == "__main__":
    main()
