from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
VIDEO = ROOT / "BLACK_SHOE" / "black_shoe 360.mp4"
cap = cv2.VideoCapture(str(VIDEO))
cap.set(cv2.CAP_PROP_POS_FRAMES, 48)
ok, frame = cap.read()
cap.release()
h, w = frame.shape[:2]
print("size", w, h)
gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
for thresh in [160, 170, 180, 190, 200, 210]:
    mask = (gray >= thresh).astype(np.uint8) * 255
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    rows = []
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area > 20 and x > w * 0.5 and y > h * 0.5:
            rows.append((area, x, y, ww, hh, tuple(round(v, 1) for v in cents[i])))
    print("thresh", thresh, "components", sorted(rows, reverse=True)[:12])

# dump crop for figures
crop = frame[int(h*0.6):h, int(w*0.6):w]
cv2.imwrite(str(ROOT / "scripts" / "inspection" / "black360_crop.png"), crop)
print("max", gray[int(h*0.6):, int(w*0.6):].max(), "mean", gray[int(h*0.6):, int(w*0.6):].mean())
