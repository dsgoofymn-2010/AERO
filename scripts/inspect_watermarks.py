"""Read video metadata and build watermark inspection contact sheets.

Outputs to scripts/inspection/:
  videos_<color>.jpg       six frames from each clip, bottom-right crops x3 zoom
  frames_<color>.jpg       sampled frame sequence bottom-right crops
  full_<color>.jpg         sampled full frames for art direction reference
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "inspection"
OUT.mkdir(parents=True, exist_ok=True)
COLORS = ["blue", "brown", "black"]
FOLDERS = {"blue": "BLUE SHOE", "brown": "BROWN_SHOE", "black": "BLACK_SHOE"}
FONT = ImageFont.load_default()
meta = {}


def label_panel(img, text, size=(360, 240)):
    panel = Image.new("RGB", (size[0], size[1] + 22), (18, 18, 18))
    panel.paste(img.resize(size), (0, 22))
    d = ImageDraw.Draw(panel)
    d.text((6, 5), text, fill=(235, 235, 235), font=FONT)
    return panel


def corner(img, zoom=3):
    """Bottom-right 12% of the frame, magnified."""
    h, w = img.shape[:2]
    cw, ch = int(w * 0.12), int(h * 0.12)
    crop = img[h - ch:h, w - cw:w]
    return Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)).resize((cw * zoom // 2, ch * zoom // 2), Image.LANCZOS)


for color in COLORS:
    folder = ROOT / FOLDERS[color]
    panels = []
    for video in sorted(folder.glob("*.mp4")):
        cap = cv2.VideoCapture(str(video))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        info = {"file": str(video.relative_to(ROOT)), "width": w, "height": h, "fps": round(fps, 2),
                "frames": frames, "duration": round(frames / fps, 2) if fps else None}
        meta[info["file"]] = info
        picks = np.linspace(2, max(frames - 3, 2), 5).astype(int)
        for i, n in enumerate(picks):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(n))
            ok, frame = cap.read()
            if not ok:
                continue
            c = corner(frame)
            c = c.resize((c.width * 2, c.height * 2), Image.LANCZOS)
            panels.append(label_panel(c, f"{video.name} f{n}/{frames}", (c.width, c.height)))
        cap.release()
    if panels:
        cols = 2
        rows = (len(panels) + cols - 1) // cols
        pw, ph = panels[0].size
        sheet = Image.new("RGB", (cols * pw, rows * ph), (10, 10, 10))
        for i, p in enumerate(panels):
            sheet.paste(p, ((i % cols) * pw, (i // cols) * ph))
        sheet.save(OUT / f"videos_{color}.jpg", quality=92)

    # frame sequence: 12 samples across the rotation
    fs = sorted((ROOT / "assets" / color / "source_frames").glob("*.jpg"))
    if fs:
        idx = np.linspace(0, len(fs) - 1, 12).astype(int)
        panels, fulls = [], []
        for i in idx:
            frame = cv2.imread(str(fs[i]))
            if frame is None:
                continue
            c = corner(frame)
            c = c.resize((c.width * 2, c.height * 2), Image.LANCZOS)
            panels.append(label_panel(c, fs[i].name, (c.width, c.height)))
            fulls.append(label_panel(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), fs[i].name, (480, 270)))
        cols = 3
        rows = (len(panels) + cols - 1) // cols
        pw, ph = panels[0].size
        sheet = Image.new("RGB", (cols * pw, rows * ph), (10, 10, 10))
        for i, p in enumerate(panels):
            sheet.paste(p, ((i % cols) * pw, (i // cols) * ph))
        sheet.save(OUT / f"frames_{color}_corners.jpg", quality=92)

        rows = (len(fulls) + 2) // 3
        pw, ph = fulls[0].size
        sheet = Image.new("RGB", (3 * pw, rows * ph), (10, 10, 10))
        for i, p in enumerate(fulls):
            sheet.paste(p, ((i % 3) * pw, (i // 3) * ph))
        sheet.save(OUT / f"full_{color}.jpg", quality=90)

(OUT / "video_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print(json.dumps(meta, indent=2))
