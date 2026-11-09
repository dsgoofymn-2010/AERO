from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "inspection"
COLORS = {"blue": "BLUE SHOE", "brown": "BROWN_SHOE", "black": "BLACK_SHOE"}
panels = []
for color in COLORS:
    fs = sorted((ROOT / "assets" / color / "source_frames").glob("*.jpg"))
    for f in [fs[0], fs[len(fs)//2], fs[-1]]:
        frame = cv2.imread(str(f))
        h, w = frame.shape[:2]
        # region equivalent to video x=700-854 y=350-480, scaled to 1920x1080
        x0, y0 = int(700 * w / 854), int(350 * h / 480)
        crop = frame[y0:h, x0:w]
        im = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        im = ImageEnhance.Contrast(im).enhance(3.0)
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        p = Image.new("RGB", (im.width, im.height + 22), (10, 10, 10))
        p.paste(im, (0, 22))
        ImageDraw.Draw(p).text((5, 5), f"{f.name}", fill=(255, 255, 255))
        panels.append(p)
        # max in watermark boxes
        star = frame[int(374*h/480):int(422*h/480), int(742*w/854):int(798*w/854)]
        veo = frame[int(443*h/480):int(477*h/480), int(805*w/854):w]
        print(color, f.name, "star_max", int(star.max()), "veo_max", int(veo.max()))
pw = max(p.width for p in panels)
ph = max(p.height for p in panels)
cols = 3
rows = (len(panels)+2)//3
sheet = Image.new("RGB", (cols*pw, rows*ph), (0,0,0))
for i,p in enumerate(panels):
    sheet.paste(p, ((i%cols)*pw, (i//cols)*ph))
sheet.save(OUT/"frame_watermark_check.jpg", quality=94)
print("saved", sheet.size)
