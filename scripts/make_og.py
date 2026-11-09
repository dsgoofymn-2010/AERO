from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
im = Image.open(ROOT / "assets/blue/posters/360.webp").convert("RGB")
w, h = im.size
# 1200x630 centre crop
target_ratio = 1200 / 630
ratio = w / h
if ratio > target_ratio:
    new_w = int(h * target_ratio)
    im = im.crop(((w - new_w) // 2, 0, (w + new_w) // 2, h))
else:
    new_h = int(w / target_ratio)
    im = im.crop((0, (h - new_h) // 2, w, (h + new_h) // 2))
im = im.resize((1200, 630), Image.Resampling.LANCZOS)
# subtle dark grade for legibility
overlay = Image.new("RGBA", im.size, (8, 8, 10, 60))
im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 54)
    small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 20)
except Exception:
    font = ImageFont.load_default()
    small = font
d.text((64, 500), "STRATA", font=font, fill=(242, 239, 233))
d.text((66, 570), "Three studies in walking.", font=small, fill=(180, 177, 170))
im.save(ROOT / "assets/og.jpg", quality=88, optimize=True)
print("wrote assets/og.jpg", im.size)
