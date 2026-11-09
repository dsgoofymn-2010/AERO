from pathlib import Path
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
for tag, p in [("original", ROOT/"assets/blue/source_frames/frame_171.jpg"), ("clean", ROOT/"assets/blue/clean/frames/frame_171.jpg")]:
    img = cv2.imread(str(p))
    h, w = img.shape[:2]
    x0, y0 = int(w*0.6), int(h*0.6)
    crop = cv2.cvtColor(img[y0:h, x0:w], cv2.COLOR_BGR2RGB)
    im = Image.fromarray(crop).resize(((w-x0)*2, (h-y0)*2), Image.LANCZOS)
    im.save(ROOT/"scripts/inspection"/f"frame171_{tag}.jpg", quality=94)
print("ok")
