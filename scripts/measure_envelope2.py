from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
for color in ["blue", "brown", "black"]:
    fs = sorted((ROOT / "assets" / color / "clean" / "frames").glob("*.jpg"))
    union = None
    for f in fs[::4]:
        im = cv2.imread(str(f))
        h, w = im.shape[:2]
        hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
        if color == "blue":
            mask = ((hsv[:, :, 1] > 95) & (hsv[:, :, 2] > 30)).astype(np.uint8) * 255
        elif color == "brown":
            mask = ((hsv[:, :, 0] < 25) & (hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 25)).astype(np.uint8) * 255
        else:
            # dark object on mid-gray background: find large dark region below the top
            gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
            mask = (gray < 95).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
        boxes = []
        for i in range(1, n):
            x, y, ww, hh, area = stats[i]
            if area > w * h * 0.002:
                boxes.append((x, y, x + ww, y + hh))
        if not boxes:
            continue
        # ignore components touching the very top/bottom (lighting)
        boxes = [b for b in boxes if b[1] < h * 0.85]
        if not boxes:
            continue
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        union = (x0, y0, x1, y1) if union is None else (min(union[0], x0), min(union[1], y0), max(union[2], x1), max(union[3], y1))
    if union:
        x0, y0, x1, y1 = union
        print(color, "bbox px", union, "fractions", round(x0/w,3), round(y0/h,3), round(x1/w,3), round(y1/h,3),
              "w", round((x1-x0)/w,3), "h", round((y1-y0)/h,3))
    else:
        print(color, "no union")
