"""Detect static white watermark components (sparkle + Veo text) in the lower-right area.

For every video (samples) and every source frame, collect bright connected components
in the ROI and report recurring locations. Outputs scripts/inspection/detection.json.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from collections import Counter, defaultdict

ROOT = Path(__file__).resolve().parents[1]
COLORS = ["blue", "brown", "black"]
FOLDERS = {"blue": "BLUE SHOE", "brown": "BROWN_SHOE", "black": "BLACK_SHOE"}
OUT = ROOT / "scripts" / "inspection"
OUT.mkdir(parents=True, exist_ok=True)
report = {"videos": {}, "frames": {}}


def bright_components(frame, thresh=215, min_area=25):
    h, w = frame.shape[:2]
    x0, y0 = int(w * 0.55), int(h * 0.55)
    roi = frame[y0:h, x0:w]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    mask = (gray >= thresh).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area >= min_area:
            out.append({"x": int(x + x0), "y": int(y + y0), "w": int(ww), "h": int(hh),
                        "area": int(area), "cx": round(float(cents[i][0] + x0), 1),
                        "cy": round(float(cents[i][1] + y0), 1)})
    return out


def cluster(components, frame_count, width, height):
    """Group component boxes by rounded normalized center to find the static watermark."""
    buckets = defaultdict(list)
    for comp in components:
        key = (round(comp["cx"] / width, 2), round(comp["cy"] / height, 2))
        buckets[key].append(comp)
    rows = []
    for key, comps in buckets.items():
        if len(comps) >= max(3, frame_count * 0.6):
            rows.append({"norm_center": key, "hits": len(comps), "samples": len(components),
                         "w": int(np.median([c["w"] for c in comps])),
                         "h": int(np.median([c["h"] for c in comps])),
                         "area": int(np.median([c["area"] for c in comps]))})
    rows.sort(key=lambda r: -r["hits"])
    return rows


for color in COLORS:
    all_comp = []
    infos = {}
    for video in sorted((ROOT / FOLDERS[color]).glob("*.mp4")):
        cap = cv2.VideoCapture(str(video))
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        comps = []
        for f in np.linspace(2, n - 3, 12).astype(int):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(f))
            ok, frame = cap.read()
            if ok:
                comps.extend(bright_components(frame))
        cap.release()
        all_comp.extend(comps)
        infos[video.name] = {"frames_sampled": 12, "hits": cluster(comps, 12, w, h),
                             "width": w, "height": h}
    report["videos"][color] = infos
    report["videos"][color + "_combined"] = cluster(all_comp, 12 * max(1, len(infos)), 854, 480)

    fs = sorted((ROOT / "assets" / color / "source_frames").glob("*.jpg"))
    comps = []
    for f in fs[::12]:
        frame = cv2.imread(str(f))
        if frame is not None:
            comps.extend(bright_components(frame, thresh=220, min_area=60))
    report["frames"][color] = {"sampled": len(fs[::12]), "recurring": cluster(comps, len(fs[::12]), 1920, 1080),
                               "total_components": len(comps)}

(OUT / "detection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
