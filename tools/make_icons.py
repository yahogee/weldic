#!/usr/bin/env python3
"""One-off helper: generate the PWA icons into app/icons/ (needs Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent.parent / "app" / "icons"
BACKGROUND = (30, 94, 168)
FOREGROUND = (255, 255, 255)
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SIZES = {"icon-192.png": 192, "icon-512.png": 512}
MASKABLE_NAME = "icon-maskable-512.png"
CORNER_RATIO = 0.22      # rounded-corner size for regular icons
FONT_RATIO = 0.62        # letter height relative to icon size


def draw_icon(size, rounded):
    """Draw a 'w' letter icon; the maskable variant is full-bleed."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if rounded:
        draw.rounded_rectangle([0, 0, size, size], radius=int(size * CORNER_RATIO), fill=BACKGROUND)
    else:
        draw.rectangle([0, 0, size, size], fill=BACKGROUND)
    font = ImageFont.truetype(FONT_PATH, int(size * FONT_RATIO))
    box = draw.textbbox((0, 0), "w", font=font)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), "w", font=font, fill=FOREGROUND)
    return image


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        draw_icon(size, rounded=True).save(OUT_DIR / name)
    draw_icon(512, rounded=False).save(OUT_DIR / MASKABLE_NAME)
    print("icons written to", OUT_DIR)


if __name__ == "__main__":
    main()
