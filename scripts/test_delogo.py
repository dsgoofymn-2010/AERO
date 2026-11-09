"""Test video watermark removal with ffmpeg delogo, then write before/after corner crops."""
from pathlib import Path
import subprocess
import cv2
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = ROOT / "scripts" / "inspection" / "delogo_test"
OUT.mkdir(parents=True, exist_ok=True)

CASES = [
    (ROOT / "BLACK_SHOE" / "black_shoe close up.mp4", "black_close"),
    (ROOT / "BLUE SHOE" / "blue_shoe parts.mp4", "blue_parts"),
    (ROOT / "BROWN_SHOE" / "brown_shoe  360.mp4", "brown_360"),
]
STAR = "delogo=x=742:y=374:w=56:h=48"
VEO = "delogo=x=805:y=443:w=46:h=34"

for src, tag in CASES:
    dst = OUT / f"{tag}_clean.mp4"
    vf = f"{STAR},{VEO},format=yuv420p"
    cmd = [FF, "-y", "-i", str(src), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
           "-crf", "19", "-an", str(dst)]
    print("RUN", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    print("rc", r.returncode, r.stderr[-800:])


def corner(frame, x0=700, y0=350, scale=5, boost=2.8):
    h, w = frame.shape[:2]
    crop = frame[y0:h, x0:w]
    im = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    im = ImageEnhance.Contrast(im).enhance(boost)
    return im.resize((im.width * scale, im.height * scale), Image.LANCZOS)


panels = []
for src, tag in CASES:
    cap = cv2.VideoCapture(str(src))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * 0.8))
    _, before = cap.read()
    cap.release()
    cap = cv2.VideoCapture(str(OUT / f"{tag}_clean.mp4"))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * 0.8))
    _, after = cap.read()
    cap.release()
    for label, frame in [("before", before), ("after", after)]:
        im = corner(frame)
        p = Image.new("RGB", (im.width, im.height + 24), (10, 10, 10))
        p.paste(im, (0, 24))
        ImageDraw.Draw(p).text((6, 6), f"{tag} {label}", fill=(255, 255, 255))
        panels.append(p)
pw = max(p.width for p in panels)
ph = max(p.height for p in panels)
sheet = Image.new("RGB", (2 * pw, 3 * ph), (0, 0, 0))
for i, p in enumerate(panels):
    sheet.paste(p, ((i % 2) * pw, (i // 2) * ph))
sheet.save(OUT / "before_after.jpg", quality=93)
print("saved", OUT / "before_after.jpg", sheet.size)
