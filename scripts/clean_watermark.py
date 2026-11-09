#!/usr/bin/env python3
"""
STRATA asset cleaner
====================
Removes AI watermarks (Gemini sparkle + Veo wordmark) from the supplied clips and
verifies that the 240-frame JPG sequences are clean. Originals are never touched.

Usage
-----
  python scripts/clean_watermark.py --frames
  python scripts/clean_watermark.py --videos
  python scripts/clean_watermark.py --all
  python scripts/clean_watermark.py --verify-only

Outputs
-------
  assets/<color>/clean/frames/frame_XXX.jpg     (clean copies / inpainted frames)
  assets/<color>/clean/videos/<name>.mp4        (delogo cleaned clips)
  assets/_verification/                          (before/after proof crops)

Requires: opencv-python-headless, pillow, imageio-ffmpeg (or ffmpeg on PATH).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
VERIFY = ASSETS / "_verification"
COLORS = ["blue", "brown", "black"]
SOURCE_FOLDERS = {"blue": "BLUE SHOE", "brown": "BROWN_SHOE", "black": "BLACK_SHOE"}

# Watermark map established by inspecting every clip at 12 sample points.
# "star" = Gemini four point star, "veo" = Veo wordmark, None = no watermark found.
VIDEO_MAP = {
    "blue": {
        "blue_shoe close up.mp4": ["star"],
        "blue_shoe parts.mp4": ["veo"],
        "blue_shoe reveal.mp4": ["veo"],
        # blue has no supplied 360 clip; one is rebuilt from the clean frames
    },
    "brown": {
        "brown_shoe  360.mp4": ["veo"],
        "brown_shoe  parts.mp4": ["star"],
        "brown_shoe  reveal.mp4": ["star"],
        "brown_shoe close up.mp4": ["star"],
    },
    "black": {
        "black_shoe 360.mp4": ["star"],
        "black_shoe close up.mp4": ["star"],
        "black_shoe parts.mp4": ["star"],
        "black_shoe reveal.mp4": ["star"],
    },
}

OUT_NAMES = {
    "360": "360",
    "parts": "parts",
    "reveal": "reveal",
    "close up": "closeup",
}

# Normalised boxes measured on the 854x480 clips, expressed at 1920x1080.
BASE_W, BASE_H = 854, 480
STAR_BOX = (742, 374, 56, 48)
VEO_BOX = (805, 443, 46, 34)


def scale_box(box, width, height):
    x, y, w, h = box
    return (round(x * width / BASE_W), round(y * height / BASE_H),
            round(w * width / BASE_W), round(h * height / BASE_H))


def ffmpeg_bin() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def output_name(src) -> str:
    stem = Path(src).stem.lower()
    for needle, label in OUT_NAMES.items():
        if needle in stem:
            return label
    return stem.replace(" ", "-")


def clean_frames():
    """Verify every frame, copy clean frames, inpaint any flagged frame."""
    summary = {}
    for color in COLORS:
        src_dir = ASSETS / color / "source_frames"
        dst_dir = ASSETS / color / "clean" / "frames"
        dst_dir.mkdir(parents=True, exist_ok=True)
        files = sorted(src_dir.glob("*.jpg"))
        flagged = []
        max_star = 0
        max_veo = 0
        for f in files:
            img = cv2.imread(str(f), cv2.IMREAD_COLOR)
            if img is None:
                print(f"  ! cannot read {f}")
                continue
            h, w = img.shape[:2]
            sx, sy, sw, sh = scale_box(STAR_BOX, w, h)
            vx, vy, vw, vh = scale_box(VEO_BOX, w, h)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            star_roi = gray[sy:sy + sh, sx:sx + sw]
            veo_roi = gray[vy:vy + vh, vx:vx + vw]
            star_max = int(star_roi.max())
            veo_max = int(veo_roi.max())
            star_hot = int((star_roi >= 225).sum())
            veo_hot = int((veo_roi >= 225).sum())
            max_star = max(max_star, star_max)
            max_veo = max(max_veo, veo_max)
            # A watermark is a compact near-white cluster, not a single bokeh speck.
            needs = star_hot >= 60 or veo_hot >= 25
            out = dst_dir / f.name
            if needs:
                flagged.append({"frame": f.name, "star_max": star_max, "veo_max": veo_max,
                                "star_hot": star_hot, "veo_hot": veo_hot})
                mask = np.zeros((h, w), np.uint8)
                if star_hot >= 60:
                    mask[sy:sy + sh, sx:sx + sw] = 255
                if veo_hot >= 25:
                    mask[vy:vy + vh, vx:vx + vw] = 255
                cleaned = cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA)
                cv2.imwrite(str(out), cleaned, [cv2.IMWRITE_JPEG_QUALITY, 95])
            else:
                shutil.copy2(f, out)
        summary[color] = {
            "frames": len(files),
            "flagged": flagged,
            "max_star_luma": max_star,
            "max_veo_luma": max_veo,
            "clean_dir": str((ASSETS / color / "clean" / "frames").relative_to(ROOT)),
        }
        print(f"{color:5s} frames: {len(files):3d} checked, {len(flagged)} flagged, "
              f"max luma star={max_star} veo={max_veo}")
    (VERIFY / "frame_scan.json").parent.mkdir(parents=True, exist_ok=True)
    (VERIFY / "frame_scan.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def build_missing_blue_360():
    """Blue arrived without a 360 clip. Rebuild it from the clean sequence.
    Frames 1-23 are a fade-in from black; the clip starts at 24 so the loop
    never opens on a black frame."""
    out = ASSETS / "blue" / "clean" / "videos" / "360.mp4"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    frames = ASSETS / "blue" / "clean" / "frames"
    cmd = [
        ffmpeg_bin(), "-y", "-framerate", "30", "-start_number", "24",
        "-i", str(frames / "frame_%03d.jpg"), "-frames:v", "215",
        "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
        "-an", "-movflags", "+faststart", str(out),
    ]
    print("Building fallback blue 360 clip from frames...")
    subprocess.run(cmd, check=True, capture_output=True)
    return out


def clean_videos():
    summary = {}
    for color in COLORS:
        src_dir = ROOT / SOURCE_FOLDERS[color]
        dst_dir = ASSETS / color / "clean" / "videos"
        dst_dir.mkdir(parents=True, exist_ok=True)
        for name, marks in VIDEO_MAP[color].items():
            src = src_dir / name
            if not src.exists():
                print(f"  ! missing source clip {src}")
                continue
            dst = dst_dir / f"{output_name(src)}.mp4"
            if not marks:
                shutil.copy2(src, dst)
                summary[f"{color}/{dst.name}"] = {"marks": [], "action": "copied (clean)"}
                continue
            filters = []
            if "star" in marks:
                x, y, w, h = STAR_BOX
                filters.append(f"delogo=x={x}:y={y}:w={w}:h={h}")
            if "veo" in marks:
                x, y, w, h = VEO_BOX
                filters.append(f"delogo=x={x}:y={y}:w={w}:h={h}")
            filters.append("format=yuv420p")
            cmd = [
                ffmpeg_bin(), "-y", "-i", str(src), "-vf", ",".join(filters),
                "-c:v", "libx264", "-preset", "slow", "-crf", "17",
                "-an", "-movflags", "+faststart", str(dst),
            ]
            print(f"Cleaning {color}/{name} -> {dst.relative_to(ROOT)}  [{'+'.join(marks)}]")
            subprocess.run(cmd, check=True, capture_output=True)
            summary[f"{color}/{dst.name}"] = {"marks": marks, "action": "delogo"}
        if color == "blue":
            build_missing_blue_360()
            summary["blue/360.mp4"] = {"marks": [], "action": "rebuilt from clean frames"}
    (VERIFY / "video_scan.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


def frame_at(cap, index):
    cap.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, frame = cap.read()
    return frame if ok else None


def crop_corner(frame, scale=4, boost=2.8):
    h, w = frame.shape[:2]
    x0, y0 = int(w * 0.70), int(h * 0.72)
    im = Image.fromarray(cv2.cvtColor(frame[y0:h, x0:w], cv2.COLOR_BGR2RGB))
    im = ImageEnhance.Contrast(im).enhance(boost)
    return im.resize((im.width * scale, im.height * scale), Image.LANCZOS)


def verify():
    """Side-by-side proof for every cleaned clip, plus numeric residual check."""
    VERIFY.mkdir(parents=True, exist_ok=True)
    rows = []
    residual = {}
    for color in COLORS:
        for src_name, marks in VIDEO_MAP[color].items():
            src = ROOT / SOURCE_FOLDERS[color] / src_name
            dst = ASSETS / color / "clean" / "videos" / f"{output_name(src_name)}.mp4"
            if not dst.exists():
                continue
            cap_a = cv2.VideoCapture(str(src))
            cap_b = cv2.VideoCapture(str(dst))
            n = int(cap_a.get(cv2.CAP_PROP_FRAME_COUNT))
            before = frame_at(cap_a, int(n * 0.82))
            after = frame_at(cap_b, int(n * 0.82))
            cap_a.release()
            cap_b.release()
            if before is None or after is None:
                continue
            panels = []
            for label, frame in (("before", before), ("after", after)):
                im = crop_corner(frame, scale=2, boost=2.5)
                p = Image.new("RGB", (im.width, im.height + 22), (12, 12, 12))
                p.paste(im, (0, 22))
                ImageDraw.Draw(p).text((5, 4), f"{color} {src_name} | {label}", fill=(240, 240, 240))
                panels.append(p)
            rows.append(panels)

            h, w = after.shape[:2]
            gray = cv2.cvtColor(after, cv2.COLOR_BGR2GRAY)
            sx, sy, sw, sh = scale_box(STAR_BOX, w, h)
            vx, vy, vw, vh = scale_box(VEO_BOX, w, h)
            # Across 12 sampled frames, check the watermark boxes for near-white residue.
            cap = cv2.VideoCapture(str(dst))
            max_star, max_veo = 0, 0
            for idx in np.linspace(2, max(n - 3, 2), 12).astype(int):
                fr = frame_at(cap, int(idx))
                if fr is None:
                    continue
                g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
                max_star = max(max_star, int(g[sy:sy + sh, sx:sx + sw].max()))
                max_veo = max(max_veo, int(g[vy:vy + vh, vx:vx + vw].max()))
            cap.release()
            residual[f"{color}/{src_name}"] = {"star_max": max_star, "veo_max": max_veo,
                                               "marks_removed": marks}

    if rows:
        pw = max(p.width for row in rows for p in row)
        ph = max(p.height for row in rows for p in row)
        sheet = Image.new("RGB", (2 * pw, len(rows) * ph), (0, 0, 0))
        for r, row in enumerate(rows):
            for c, p in enumerate(row):
                sheet.paste(p, (c * pw, r * ph))
        out = VERIFY / "video_watermarks_before_after.jpg"
        sheet.save(out, quality=92)
        print(f"Verification sheet: {out.relative_to(ROOT)}")
    (VERIFY / "video_residual.json").write_text(json.dumps(residual, indent=2), encoding="utf-8")
    print(json.dumps(residual, indent=2))


def main():
    ap = argparse.ArgumentParser(description="Clean AI watermarks from STRATA source assets.")
    ap.add_argument("--frames", action="store_true", help="scan and copy/inpaint the JPG sequences")
    ap.add_argument("--videos", action="store_true", help="delogo the MP4 clips")
    ap.add_argument("--all", action="store_true", help="frames + videos + verification")
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()
    if not any([args.frames, args.videos, args.all, args.verify_only]):
        args.all = True
    if args.all or args.frames:
        print("Scanning every source frame...")
        clean_frames()
    if args.all or args.videos:
        clean_videos()
    if args.all or args.videos or args.verify_only:
        verify()
    print("Done. Originals were not modified.")


if __name__ == "__main__":
    main()
