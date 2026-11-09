#!/usr/bin/env python3
"""
STRATA web asset optimizer
==========================
Source:  assets/<color>/clean/frames + assets/<color>/clean/videos
Output:  assets/<color>/frames/desktop|mobile/*.webp
         assets/<color>/videos/*.mp4|*.webm
         assets/<color>/posters/*.webp

Usage:
  python scripts/optimize_assets.py
  python scripts/optimize_assets.py --only-frames
  python scripts/optimize_assets.py --only-videos

Requires: pillow, opencv-python-headless, imageio-ffmpeg (or ffmpeg on PATH).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
COLORS = ["blue", "brown", "black"]
CLIPS = ["360", "reveal", "parts", "closeup"]
POSTER_TIME = {"360": 0.6, "reveal": 5.2, "parts": 3.2, "closeup": 2.0}

DESKTOP_W = 1600
MOBILE_W = 800
MOBILE_CROP = (0.15, 0.08, 0.70, 0.61)  # x, y, width, height as fractions of the 16:9 frame
FRAME_TOTAL = 240


def ffmpeg_bin() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def process_frame(args):
    """Resize and encode one frame to desktop + mobile WebP."""
    src, dst_desktop, dst_mobile = args
    with Image.open(src) as im:
        im = im.convert("RGB")
        desktop = im.resize((DESKTOP_W, round(DESKTOP_W * im.height / im.width)), Image.Resampling.LANCZOS)
        # Mobile gets a tighter 2:1 crop so the shoe reads large on portrait screens.
        x, y, cw, ch = MOBILE_CROP
        crop = im.crop((round(im.width * x), round(im.height * y),
                        round(im.width * (x + cw)), round(im.height * (y + ch))))
        mobile = crop.resize((MOBILE_W, round(MOBILE_W * crop.height / crop.width)), Image.Resampling.LANCZOS)
        desktop.save(dst_desktop, "WEBP", quality=80, method=5)
        mobile.save(dst_mobile, "WEBP", quality=78, method=5)
    return dst_desktop.stat().st_size, dst_mobile.stat().st_size


def optimize_frames():
    report = {}
    jobs = []
    for color in COLORS:
        src_dir = ASSETS / color / "clean" / "frames"
        d_dir = ASSETS / color / "frames" / "desktop"
        m_dir = ASSETS / color / "frames" / "mobile"
        d_dir.mkdir(parents=True, exist_ok=True)
        m_dir.mkdir(parents=True, exist_ok=True)
        available = {int(p.stem.split("_")[1]): p for p in src_dir.glob("frame_*.jpg")}
        if not available:
            print(f"! no clean frames for {color}, run clean_watermark.py first")
            continue
        last = max(available)
        for n in range(1, FRAME_TOTAL + 1):
            src = available.get(n, available[last])
            jobs.append((src, d_dir / f"frame_{n:03d}.webp", m_dir / f"frame_{n:03d}.webp"))
        report[color] = {"requested": FRAME_TOTAL, "source_available": len(available),
                         "duplicated_tail": [n for n in range(1, FRAME_TOTAL + 1) if n not in available]}

    print(f"Encoding {len(jobs)} frames to desktop {DESKTOP_W}px and mobile {MOBILE_W}px WebP...")
    desktop_total = 0
    mobile_total = 0
    done = 0
    with ProcessPoolExecutor(max_workers=6) as ex:
        for d_size, m_size in ex.map(process_frame, jobs, chunksize=8):
            desktop_total += d_size
            mobile_total += m_size
            done += 1
            if done % 120 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} frames | desktop {desktop_total/1e6:.1f} MB | mobile {mobile_total/1e6:.1f} MB")
    report["totals"] = {"desktop_mb": round(desktop_total / 1e6, 2), "mobile_mb": round(mobile_total / 1e6, 2)}
    (ASSETS / "_verification" / "frame_optimization.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


def make_poster(src_video: Path, out: Path, seconds: float):
    cap = cv2.VideoCapture(str(src_video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(seconds * fps))
    ok, frame = cap.read()
    if not ok:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
    cap.release()
    if not ok:
        return 0
    h, w = frame.shape[:2]
    scale = 1280 / w
    frame = cv2.resize(frame, (1280, round(h * scale)), interpolation=cv2.INTER_LANCZOS4)
    # Light unsharp for the upscaled 854x480 sources.
    if w < 1200:
        blur = cv2.GaussianBlur(frame, (0, 0), 1.1)
        frame = cv2.addWeighted(frame, 1.35, blur, -0.35, 0)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), frame, [cv2.IMWRITE_WEBP_QUALITY, 82])
    return out.stat().st_size


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FFMPEG FAILED:", " ".join(map(str, cmd)))
        print(r.stderr[-2000:])
        raise SystemExit(1)


def optimize_videos():
    report = {}
    for color in COLORS:
        src_dir = ASSETS / color / "clean" / "videos"
        out_dir = ASSETS / color / "videos"
        poster_dir = ASSETS / color / "posters"
        out_dir.mkdir(parents=True, exist_ok=True)
        poster_dir.mkdir(parents=True, exist_ok=True)
        for clip in CLIPS:
            src = src_dir / f"{clip}.mp4"
            if not src.exists():
                print(f"! missing {src}")
                continue
            mp4 = out_dir / f"{clip}.mp4"
            webm = out_dir / f"{clip}.webm"
            poster = poster_dir / f"{clip}.webp"

            mp4_filter = ("scale=1280:720:flags=lanczos,"
                          "unsharp=5:5:0.35:3:3:0.10,format=yuv420p")
            run([ffmpeg_bin(), "-y", "-i", str(src), "-vf", mp4_filter,
                 "-c:v", "libx264", "-preset", "slow", "-crf", "21",
                 "-maxrate", "1800k", "-bufsize", "3600k", "-profile:v", "high",
                 "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(mp4)])

            webm_filter = "scale=1280:720:flags=lanczos,format=yuv420p"
            run([ffmpeg_bin(), "-y", "-i", str(src), "-vf", webm_filter,
                 "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0",
                 "-row-mt", "1", "-cpu-used", "4", "-deadline", "good",
                 "-pix_fmt", "yuv420p", "-an", str(webm)])

            poster_bytes = make_poster(src, poster, POSTER_TIME.get(clip, 1.0))
            report[f"{color}/{clip}"] = {
                "mp4_mb": round(mp4.stat().st_size / 1e6, 2),
                "webm_mb": round(webm.stat().st_size / 1e6, 2),
                "poster_kb": round(poster_bytes / 1e3, 1),
            }
            print(f"{color}/{clip:7s} mp4 {report[f'{color}/{clip}']['mp4_mb']:.2f} MB | "
                  f"webm {report[f'{color}/{clip}']['webm_mb']:.2f} MB | poster {poster_bytes/1e3:.0f} KB")
    (ASSETS / "_verification" / "video_optimization.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-frames", action="store_true")
    ap.add_argument("--only-videos", action="store_true")
    args = ap.parse_args()
    if not args.only_videos:
        optimize_frames()
    if not args.only_frames:
        optimize_videos()
    print("Optimization complete.")


if __name__ == "__main__":
    main()
