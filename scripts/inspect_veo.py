from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "inspection"
COLORS = {"blue": "BLUE SHOE", "brown": "BROWN_SHOE", "black": "BLACK_SHOE"}
panels = []
for color, folder in COLORS.items():
    for video in sorted((ROOT / folder).glob("*.mp4")):
        cap = cv2.VideoCapture(str(video))
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * 0.8))
        ok, frame = cap.read()
        cap.release()
        if not ok:
            continue
        h, w = frame.shape[:2]
        # broad lower right area at 4x zoom, boosted
        x0, y0 = int(w * 0.82), int(h * 0.75)
        crop = frame[y0:h, x0:w]
        im = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        im = ImageEnhance.Contrast(im).enhance(2.4)
        im = im.resize((im.width * 4, im.height * 4), Image.LANCZOS)
        panel = Image.new("RGB", (im.width, im.height + 24), (12, 12, 12))
        panel.paste(im, (0, 24))
        ImageDraw.Draw(panel).text((6, 6), f"{video.name} | {w}x{h} | x{x0}-{w} y{y0}-{h}", fill=(255, 255, 255))
        panels.append(panel)
        print(video.name, "max", cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).max())
if panels:
    cols = 2
    rows = (len(panels) + 1) // 2
    pw = max(p.width for p in panels)
    ph = max(p.height for p in panels)
    sheet = Image.new("RGB", (cols * pw, rows * ph), (5, 5, 5))
    for i, p in enumerate(panels):
        sheet.paste(p, ((i % cols) * pw, (i // cols) * ph))
    sheet.save(OUT / "veo_zoom.jpg", quality=94)
    print("saved", OUT / "veo_zoom.jpg", sheet.size)
