from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "inspection"
cases = [("BLUE SHOE", "blue_shoe parts.mp4"), ("BROWN_SHOE", "brown_shoe  360.mp4"),
         ("BLACK_SHOE", "black_shoe 360.mp4"), ("BLUE SHOE", "blue_shoe reveal.mp4")]
FONT = ImageFont.load_default()
panels = []
for folder, name in cases:
    cap = cv2.VideoCapture(str(ROOT / folder / name))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * 0.8))
    ok, frame = cap.read()
    cap.release()
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = 740, 400, 854, 480
    crop = frame[y0:y1, x0:x1]
    im = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    im = ImageEnhance.Contrast(im).enhance(3.2)
    scale = 7
    im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    canvas = Image.new("RGB", (im.width, im.height + 30), (8, 8, 8))
    canvas.paste(im, (0, 30))
    d = ImageDraw.Draw(canvas)
    d.text((5, 8), f"{name} | crop x{x0}-{x1} y{y0}-{y1} | scale {scale}x", fill=(255, 255, 255), font=FONT)
    for gx in range(x0, x1, 10):
        px = (gx - x0) * scale
        d.line([(px, 30), (px, canvas.height)], fill=(60, 60, 60), width=1)
        d.text((px + 2, 32), str(gx), fill=(255, 90, 90), font=FONT)
    for gy in range(y0, y1, 10):
        py = 30 + (gy - y0) * scale
        d.line([(0, py), (canvas.width, py)], fill=(60, 60, 60), width=1)
        d.text((2, py + 1), str(gy), fill=(90, 255, 90), font=FONT)
    panels.append(canvas)
pw = max(p.width for p in panels)
ph = max(p.height for p in panels)
sheet = Image.new("RGB", (2 * pw, 2 * ph), (0, 0, 0))
for i, p in enumerate(panels):
    sheet.paste(p, ((i % 2) * pw, (i // 2) * ph))
sheet.save(OUT / "watermark_coords.jpg", quality=95)
print("saved", OUT / "watermark_coords.jpg", sheet.size)
