"""Zoomed bottom-right inspection with contrast boost, 30% x 25% region."""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "inspection"
FONT = ImageFont.load_default()
COLORS = ["blue", "brown", "black"]
FOLDERS = {"blue": "BLUE SHOE", "brown": "BROWN_SHOE", "black": "BLACK_SHOE"}


def br(img, xfrac=0.70, yfrac=0.72, zoom=2.2, boost=3.0):
    h, w = img.shape[:2]
    x, y = int(w * xfrac), int(h * yfrac)
    crop = cv2.cvtColor(img[y:h, x:w], cv2.COLOR_BGR2RGB)
    im = Image.fromarray(crop)
    im = ImageEnhance.Contrast(im).enhance(boost)
    return im.resize((int(im.width * zoom / 2), int(im.height * zoom / 2)), Image.LANCZOS)


def panel(img, text, width=620):
    ratio = width / img.width
    img = img.resize((width, int(img.height * ratio)), Image.LANCZOS)
    p = Image.new("RGB", (width, img.height + 20), (15, 15, 15))
    p.paste(img, (0, 20))
    ImageDraw.Draw(p).text((5, 4), text, fill=(240, 240, 240), font=FONT)
    return p


for color in COLORS:
    panels = []
    for video in sorted((ROOT / FOLDERS[color]).glob("*.mp4")):
        cap = cv2.VideoCapture(str(video))
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        for f in [n // 4, n // 2, int(n * 0.8)]:
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ok, frame = cap.read()
            if ok:
                panels.append(panel(br(frame), f"{video.name} f{f} boosted"))
        cap.release()
    fs = sorted((ROOT / "assets" / color / "source_frames").glob("*.jpg"))
    for i in [0, len(fs) // 4, len(fs) // 2, int(len(fs) * 0.8), len(fs) - 1]:
        frame = cv2.imread(str(fs[i]))
        panels.append(panel(br(frame), f"{fs[i].name} boosted"))

    cols = 3
    rows = (len(panels) + cols - 1) // cols
    pw = max(p.width for p in panels)
    ph = max(p.height for p in panels)
    sheet = Image.new("RGB", (cols * pw, rows * ph), (5, 5, 5))
    for i, p in enumerate(panels):
        sheet.paste(p, ((i % cols) * pw, (i // cols) * ph))
    sheet.save(OUT / f"zoom_{color}.jpg", quality=93)
    print("wrote", OUT / f"zoom_{color}.jpg", sheet.size)
