from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
for color in ["blue", "brown", "black"]:
    fs = sorted((ROOT / "assets" / color / "clean" / "frames").glob("*.jpg"))
    sample = fs[::6]
    imgs = [cv2.imread(str(f)) for f in sample]
    h, w = imgs[0].shape[:2]
    med = np.median(np.stack([cv2.resize(im, (320, 180)) for im in imgs]), axis=0).astype(np.uint8)
    union = None
    areas = []
    for im in imgs:
        small = cv2.resize(im, (320, 180))
        diff = cv2.absdiff(small, med)
        gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
        # Shoe differs from the median background; ignore the soft floor shadow.
        mask = (gray > 34).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
        boxes = []
        for i in range(1, n):
            x, y, ww, hh, area = stats[i]
            if area > 120:
                boxes.append((x, y, x + ww, y + hh))
        if not boxes:
            continue
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        areas.append((x1 - x0) * (y1 - y0))
        union = (x0, y0, x1, y1) if union is None else (min(union[0], x0), min(union[1], y0), max(union[2], x1), max(union[3], y1))
    if union:
        x0, y0, x1, y1 = [v / 320 for v in union]
        print(color, "union bbox full-frame fractions", round(x0,3), round(y0,3), round(x1,3), round(y1,3),
              "| size", round(x1-x0,3), "x", round(y1-y0,3), "| aspect", round((x1-x0)/(y1-y0),2))
