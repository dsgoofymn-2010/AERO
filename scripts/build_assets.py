#!/usr/bin/env python3
"""Build AERO public assets from the untouched source delivery.

Outputs only under public/:
  public/shoes/<id>/still-1600.webp
  public/shoes/<id>/still-800.webp
  public/shoes/<id>/detail-1600.webp
  public/shoes/<id>/poster-*.webp
  public/shoes/<id>/360.mp4|webm
  public/shoes/<id>/exploded.mp4|webm
  public/shoes/<id>/closeup.mp4|webm
  public/shoes/<id>/reveal.mp4|webm
  public/shoes/<id>/frames/desktop/frame_###.webp
  public/shoes/<id>/frames/mobile/frame_###.webp
  public/_verification/*

Usage:
  python scripts/build_assets.py
  python scripts/build_assets.py --only images
  python scripts/build_assets.py --only videos
  python scripts/build_assets.py --only frames
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SHOES_DIR = PUBLIC / "shoes"
VERIFY = PUBLIC / "_verification"
BLUE_FRAMES = ROOT / "assets" / "blue" / "clean" / "frames"

BASE_W, BASE_H = 854, 480
STAR_BOX = (742, 374, 56, 48)
VEO_BOX = (805, 443, 46, 34)
MARK_BOXES = {"star": STAR_BOX, "veo": VEO_BOX}

VIDEO_CRF = "18"
WEBM_CRF = "34"
POSTER_AT = {"360": 0.5, "exploded": 0.45, "closeup": 0.35, "reveal": 0.6}
EXPECTED_FRAMES = {"blue": 215, "brown": 192, "black": 192}

SHOES = [
    {
        "id": "blue",
        "name": "Cirra",
        "folder": "BLUE SHOE",
        "still": "blue shoe.jpeg",
        "hero": True,
        "rebuild360": True,
        "clips": {
            "360": {"file": None, "marks": []},
            "exploded": {"file": "blue_shoe parts.mp4", "marks": ["veo"]},
            "closeup": {"file": "blue_shoe close up.mp4", "marks": ["star"]},
            "reveal": {"file": "blue_shoe reveal.mp4", "marks": ["veo"]},
        },
    },
    {
        "id": "brown",
        "name": "Terrae",
        "folder": "BROWN_SHOE",
        "still": "brown_shoe .jpeg",
        "hero": True,
        "rebuild360": False,
        "clips": {
            "360": {"file": "brown_shoe  360.mp4", "marks": ["veo"]},
            "exploded": {"file": "brown_shoe  parts.mp4", "marks": ["star"]},
            "closeup": {"file": "brown_shoe close up.mp4", "marks": ["star"]},
            "reveal": {"file": "brown_shoe  reveal.mp4", "marks": ["star"]},
        },
    },
    {
        "id": "black",
        "name": "Onyx",
        "folder": "BLACK_SHOE",
        "still": "black shoe.jpeg",
        "hero": True,
        "rebuild360": False,
        "clips": {
            "360": {"file": "black_shoe 360.mp4", "marks": ["star"]},
            "exploded": {"file": "black_shoe parts.mp4", "marks": ["star"]},
            "closeup": {"file": "black_shoe close up.mp4", "marks": ["star"]},
            "reveal": {"file": "black_shoe reveal.mp4", "marks": ["star"]},
        },
    },
    {
        "id": "kestrel",
        "name": "Kestrel",
        "folder": "Chelsea boot",
        "still": "Chelsea boot.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {
            "360": {"file": "Chelsea boot 360.mp4", "marks": ["star"]},
            "exploded": {"file": "Chelsea boot exploded.mp4", "marks": ["veo"]},
            "closeup": {"file": "Chelsea boot close up.mp4", "marks": ["star"]},
        },
    },
    {
        "id": "vertex",
        "name": "Vertex",
        "folder": "High-top basketball sneaker",
        "still": "High-top basketball sneaker.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {
            "360": {"file": "High-top basketball sneaker 360.mp4", "marks": ["star"]},
            "exploded": {"file": "High-top basketball sneaker exploded.mp4", "marks": ["star"]},
            "closeup": {"file": "High-top basketball sneaker close up.mp4", "marks": ["star"]},
        },
    },
    {
        "id": "trace",
        "name": "Trace",
        "folder": "Trail running shoe",
        "still": "Trail running shoe.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {
            "360": {"file": "Trail running shoe 360.mp4", "marks": ["star"]},
            "exploded": {"file": "Trail running shoe exploded.mp4", "marks": ["star"]},
            "closeup": {"file": "Trail running shoe close up.mp4", "marks": ["star"]},
        },
    },
    {
        "id": "covent",
        "name": "Covent",
        "folder": "new shoes",
        "still": "Derby shoe.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {},
    },
    {
        "id": "cairn",
        "name": "Cairn",
        "folder": "new shoes",
        "still": "Hiking boot.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {},
    },
    {
        "id": "kerb",
        "name": "Kerb",
        "folder": "new shoes",
        "still": "Low-top skate shoe.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {},
    },
    {
        "id": "alba",
        "name": "Alba",
        "folder": "new shoes",
        "still": "Minimalist white sneaker.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {},
    },
    {
        "id": "ledger",
        "name": "Ledger",
        "folder": "new shoes",
        "still": "Penny loafer.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {},
    },
    {
        "id": "dune",
        "name": "Dune",
        "folder": "new shoes",
        "still": "Slide sandal.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {},
    },
    {
        "id": "loom",
        "name": "Loom",
        "folder": "new shoes",
        "still": "Slip-on knit sneaker.jpeg",
        "hero": False,
        "rebuild360": False,
        "clips": {},
    },
]


def ffmpeg_bin() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


FFMPEG = ffmpeg_bin()


def human(num: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.1f} {unit}" if unit != "B" else f"{num} B"
        num /= 1024
    return f"{num:.1f} GB"


def run(cmd: list[str], label: str) -> None:
    print(f"  {label}", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        print(result.stderr[-4000:], flush=True)
        raise SystemExit(f"ffmpeg failed: {label}")


def scale_box(box: tuple[int, int, int, int], width: int, height: int):
    x, y, w, h = box
    return (
        round(x * width / BASE_W),
        round(y * height / BASE_H),
        max(1, round(w * width / BASE_W)),
        max(1, round(h * height / BASE_H)),
    )


def box_metrics(gray: np.ndarray, box: tuple[int, int, int, int]) -> dict:
    x, y, w, h = box
    roi = gray[y : y + h, x : x + w]
    return {"max": int(roi.max()), "hot": int((roi >= 225).sum())}


_TEMPLATES: dict[str, np.ndarray | None] = {}


def templates() -> dict[str, np.ndarray | None]:
    if _TEMPLATES:
        return _TEMPLATES
    star_src = ROOT / "BLUE SHOE" / "blue_shoe close up.mp4"
    veo_src = ROOT / "Chelsea boot" / "Chelsea boot exploded.mp4"
    for name, path, box in (("star", star_src, STAR_BOX), ("veo", veo_src, VEO_BOX)):
        frame = read_frame(path, 0.82)
        if frame is None:
            _TEMPLATES[name] = None
            continue
        x, y, w, h = box
        _TEMPLATES[name] = cv2.cvtColor(frame[y : y + h, x : x + w], cv2.COLOR_BGR2GRAY)
    return _TEMPLATES


def match_score(gray: np.ndarray, box: tuple[int, int, int, int], template: np.ndarray | None) -> float:
    if template is None:
        return 0.0
    x, y, w, h = box
    roi = gray[y : y + h, x : x + w]
    tpl = cv2.resize(template, (w, h), interpolation=cv2.INTER_AREA)
    if tpl.shape[0] > roi.shape[0] or tpl.shape[1] > roi.shape[1]:
        return 0.0
    return round(float(cv2.matchTemplate(roi, tpl, cv2.TM_CCOEFF_NORMED).max()), 3)


def scan_image(path: Path) -> dict:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"cannot read image: {path}")
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    x0, y0 = int(w * 0.92), int(h * 0.92)
    br = gray[y0:h, x0:w]
    return {
        "width": w,
        "height": h,
        "bottom_right_max": int(br.max()),
        "bottom_right_hot": int((br >= 225).sum()),
        "star": box_metrics(gray, scale_box(STAR_BOX, w, h)),
        "veo": box_metrics(gray, scale_box(VEO_BOX, w, h)),
    }


def inpaint_corner(img: np.ndarray, scan: dict) -> tuple[np.ndarray, str]:
    if scan["bottom_right_hot"] < 120:
        return img, "clean"
    h, w = img.shape[:2]
    x0, y0 = int(w * 0.92), int(h * 0.92)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = np.zeros((h, w), np.uint8)
    mask[y0:h, x0:w] = ((gray[y0:h, x0:w] >= 210) * 255).astype(np.uint8)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    return cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA), "inpaint"


def resize_width(im: Image.Image, width: int) -> Image.Image:
    if im.width <= width:
        return im.copy()
    return im.resize((width, round(im.height * width / im.width)), Image.Resampling.LANCZOS)


def save_webp(im: Image.Image, path: Path, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, method=6)


def process_still(shoe: dict) -> dict:
    src = ROOT / shoe["folder"] / shoe["still"]
    scan = scan_image(src)
    img = cv2.imread(str(src), cv2.IMREAD_COLOR)
    cleaned, action = inpaint_corner(img, scan)
    if action == "inpaint":
        jpg = SHOES_DIR / shoe["id"] / "still-clean.jpg"
        jpg.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(jpg), cleaned, [cv2.IMWRITE_JPEG_QUALITY, 95])
    rgb = cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB)
    im = ImageOps.exif_transpose(Image.fromarray(rgb))
    out_dir = SHOES_DIR / shoe["id"]
    still = resize_width(im, 1600)
    mobile = resize_width(im, 800)
    detail = resize_width(im, 1600)
    save_webp(still, out_dir / "still-1600.webp", 85)
    save_webp(mobile, out_dir / "still-800.webp", 85)
    save_webp(detail, out_dir / "detail-1600.webp", 90)
    files = {}
    for name in ("still-1600.webp", "still-800.webp", "detail-1600.webp"):
        p = out_dir / name
        files[name] = p.stat().st_size
    return {
        "source": str(src.relative_to(ROOT)),
        "action": action,
        "scan": scan,
        "width": still.width,
        "height": still.height,
        "files": files,
    }


def build_blue_360(out: Path) -> None:
    if not BLUE_FRAMES.exists():
        raise SystemExit(f"missing blue clean frames: {BLUE_FRAMES}")
    for n in (24, 238):
        if not (BLUE_FRAMES / f"frame_{n:03d}.jpg").exists():
            raise SystemExit(f"missing blue source frame {n}")
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        FFMPEG,
        "-y",
        "-framerate",
        "24",
        "-start_number",
        "24",
        "-i",
        str(BLUE_FRAMES / "frame_%03d.jpg"),
        "-frames:v",
        str(EXPECTED_FRAMES["blue"]),
        "-vf",
        "scale=1280:720:flags=lanczos,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        VIDEO_CRF,
        "-g",
        "24",
        "-keyint_min",
        "24",
        "-sc_threshold",
        "0",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        str(out),
    ]
    run(cmd, "blue/360 H.264 rebuilt from clean frames")


def encode_h264(src: Path, out: Path, marks: list[str]) -> None:
    filters = []
    for mark in marks:
        x, y, w, h = MARK_BOXES[mark]
        filters.append(f"delogo=x={x}:y={y}:w={w}:h={h}")
    filters.extend(["scale=1280:720:flags=lanczos", "format=yuv420p"])
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        FFMPEG,
        "-y",
        "-i",
        str(src),
        "-vf",
        ",".join(filters),
        "-r",
        "24",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        VIDEO_CRF,
        "-g",
        "24",
        "-keyint_min",
        "24",
        "-sc_threshold",
        "0",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        str(out),
    ]
    run(cmd, f"{out.parent.name}/{out.name} H.264")


def encode_webm(mp4: Path, webm: Path) -> None:
    cmd = [
        FFMPEG,
        "-y",
        "-i",
        str(mp4),
        "-c:v",
        "libvpx-vp9",
        "-crf",
        WEBM_CRF,
        "-b:v",
        "0",
        "-g",
        "24",
        "-row-mt",
        "1",
        "-cpu-used",
        "4",
        "-deadline",
        "good",
        "-an",
        str(webm),
    ]
    run(cmd, f"{webm.parent.name}/{webm.name} WebM")


def read_frame(path: Path, fraction: float) -> np.ndarray | None:
    cap = cv2.VideoCapture(str(path))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if n <= 0:
        cap.release()
        return None
    idx = min(n - 1, max(0, int(n * fraction)))
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


def make_poster(mp4: Path, poster: Path, fraction: float) -> None:
    frame = read_frame(mp4, fraction)
    if frame is None:
        raise SystemExit(f"cannot read poster frame: {mp4}")
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    save_webp(Image.fromarray(rgb), poster, 85)


def scan_video(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    star_box = scale_box(STAR_BOX, w, h)
    veo_box = scale_box(VEO_BOX, w, h)
    tpl = templates()
    star_max = star_hot = veo_max = veo_hot = 0
    star_match = veo_match = 0.0
    for f in np.linspace(2, max(n - 3, 2), 12).astype(int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(f))
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        sm = box_metrics(gray, star_box)
        vm = box_metrics(gray, veo_box)
        star_max = max(star_max, sm["max"])
        star_hot = max(star_hot, sm["hot"])
        veo_max = max(veo_max, vm["max"])
        veo_hot = max(veo_hot, vm["hot"])
        star_match = max(star_match, match_score(gray, star_box, tpl["star"]))
        veo_match = max(veo_match, match_score(gray, veo_box, tpl["veo"]))
    cap.release()
    return {
        "width": w,
        "height": h,
        "frames": n,
        "star_max": star_max,
        "star_hot": star_hot,
        "star_match": star_match,
        "veo_max": veo_max,
        "veo_hot": veo_hot,
        "veo_match": veo_match,
    }


def process_video(shoe: dict, label: str, info: dict) -> dict:
    out_dir = SHOES_DIR / shoe["id"]
    mp4 = out_dir / f"{label}.mp4"
    webm = out_dir / f"{label}.webm"
    poster = out_dir / f"poster-{label}.webp"
    source = None if shoe.get("rebuild360") and label == "360" else ROOT / shoe["folder"] / info["file"]
    if source is not None and not source.exists():
        raise SystemExit(f"missing source clip: {source}")
    before = scan_video(source) if source is not None else {"action": "rebuilt from clean frames"}
    if shoe.get("rebuild360") and label == "360":
        build_blue_360(mp4)
        action = "rebuilt from clean frames"
    else:
        encode_h264(source, mp4, info["marks"])
        action = "delogo" if info["marks"] else "clean"
    encode_webm(mp4, webm)
    make_poster(mp4, poster, POSTER_AT[label])
    residual = scan_video(mp4)
    return {
        "source": str(source.relative_to(ROOT)) if source is not None else None,
        "marks": info["marks"],
        "action": action,
        "before": before,
        "residual": residual,
        "files": {
            f"{label}.mp4": mp4.stat().st_size,
            f"{label}.webm": webm.stat().st_size,
            f"poster-{label}.webp": poster.stat().st_size,
        },
    }


def extract_frames(shoe: dict, mp4: Path) -> dict:
    out_dir = SHOES_DIR / shoe["id"] / "frames"
    result = {}
    for label, width, height, quality in (
        ("desktop", 1280, 720, 80),
        ("mobile", 720, 405, 76),
    ):
        target = out_dir / label
        target.mkdir(parents=True, exist_ok=True)
        for old in target.glob("frame_*.webp"):
            old.unlink()
        cmd = [
            FFMPEG,
            "-y",
            "-i",
            str(mp4),
            "-vf",
            f"scale={width}:{height}:flags=lanczos",
            "-c:v",
            "libwebp",
            "-quality",
            str(quality),
            "-compression_level",
            "6",
            "-fps_mode",
            "passthrough",
            str(target / "frame_%03d.webp"),
        ]
        run(cmd, f"{shoe['id']}/frames/{label}")
        files = sorted(target.glob("frame_*.webp"))
        total = sum(p.stat().st_size for p in files)
        result[label] = {
            "count": len(files),
            "width": width,
            "height": height,
            "bytes": total,
            "first": files[0].name if files else None,
            "last": files[-1].name if files else None,
        }
        expected = EXPECTED_FRAMES.get(shoe["id"])
        if expected and len(files) != expected:
            raise SystemExit(f"{shoe['id']} {label} frames: expected {expected}, got {len(files)}")
    return result


def crop_corner(frame: np.ndarray, scale: float = 2.0, boost: float = 2.2) -> Image.Image:
    h, w = frame.shape[:2]
    x0, y0 = int(w * 0.70), int(h * 0.72)
    im = Image.fromarray(cv2.cvtColor(frame[y0:h, x0:w], cv2.COLOR_BGR2RGB))
    im = ImageEnhance.Contrast(im).enhance(boost)
    return im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)


def make_video_proofs(records: list[dict]) -> list[str]:
    rows = []
    for rec in records:
        if not rec["marks"] or not rec["source"]:
            continue
        src = ROOT / rec["source"]
        dst = SHOES_DIR / rec["shoe"] / f"{rec['label']}.mp4"
        before = read_frame(src, 0.82)
        after = read_frame(dst, 0.82)
        if before is None or after is None:
            continue
        panels = []
        for label, frame in (("before", before), ("after", after)):
            im = crop_corner(frame)
            panel = Image.new("RGB", (im.width, im.height + 24), (10, 10, 11))
            panel.paste(im, (0, 24))
            ImageDraw.Draw(panel).text(
                (6, 5), f"{rec['shoe']} {rec['label']} | {label} | {','.join(rec['marks'])}",
                fill=(235, 235, 235),
            )
            panels.append(panel)
        rows.append(panels)
    if not rows:
        return []
    pw = max(p.width for row in rows for p in row)
    ph = max(p.height for row in rows for p in row)
    sheet = Image.new("RGB", (2 * pw, len(rows) * ph), (0, 0, 0))
    for r, row in enumerate(rows):
        for c, panel in enumerate(row):
            sheet.paste(panel, (c * pw, r * ph))
    out = VERIFY / "watermark-before-after.jpg"
    sheet.save(out, quality=88)
    return [str(out.relative_to(PUBLIC))]


def make_clean_corner_sheet(records: list[dict]) -> list[str]:
    panels = []
    for rec in records:
        dst = SHOES_DIR / rec["shoe"] / f"{rec['label']}.mp4"
        frame = read_frame(dst, 0.82)
        if frame is None:
            continue
        im = crop_corner(frame, scale=1.25, boost=1.8)
        panel = Image.new("RGB", (im.width, im.height + 22), (10, 10, 11))
        panel.paste(im, (0, 22))
        ImageDraw.Draw(panel).text((5, 4), f"{rec['shoe']} / {rec['label']}", fill=(235, 235, 235))
        panels.append(panel)
    if not panels:
        return []
    cols = 4
    pw = max(p.width for p in panels)
    ph = max(p.height for p in panels)
    rows = (len(panels) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * pw, rows * ph), (0, 0, 0))
    for i, panel in enumerate(panels):
        sheet.paste(panel, ((i % cols) * pw, (i // cols) * ph))
    out = VERIFY / "cleaned-corners.jpg"
    sheet.save(out, quality=88)
    return [str(out.relative_to(PUBLIC))]


def make_still_corner_sheet(stills: list[dict]) -> list[str]:
    panels = []
    for rec in stills:
        src = ROOT / rec["source"]
        img = cv2.imread(str(src), cv2.IMREAD_COLOR)
        if img is None:
            continue
        im = crop_corner(img, scale=1.5, boost=1.8)
        panel = Image.new("RGB", (im.width, im.height + 22), (10, 10, 11))
        panel.paste(im, (0, 22))
        ImageDraw.Draw(panel).text((5, 4), f"{rec['id']} | clean", fill=(235, 235, 235))
        panels.append(panel)
    if not panels:
        return []
    cols = 4
    pw = max(p.width for p in panels)
    ph = max(p.height for p in panels)
    rows = (len(panels) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * pw, rows * ph), (0, 0, 0))
    for i, panel in enumerate(panels):
        sheet.paste(panel, ((i % cols) * pw, (i // cols) * ph))
    out = VERIFY / "still-corners.jpg"
    sheet.save(out, quality=88)
    return [str(out.relative_to(PUBLIC))]


def main() -> None:
    ap = argparse.ArgumentParser(description="Build AERO public assets.")
    ap.add_argument("--only", choices=["all", "images", "videos", "frames"], default="all")
    args = ap.parse_args()

    started = time.time()
    PUBLIC.mkdir(exist_ok=True)
    SHOES_DIR.mkdir(exist_ok=True)
    VERIFY.mkdir(exist_ok=True)

    stills = []
    videos = []
    frame_sets = {}

    if args.only in ("all", "images"):
        print("Images", flush=True)
        for shoe in SHOES:
            rec = process_still(shoe)
            rec["id"] = shoe["id"]
            rec["name"] = shoe["name"]
            stills.append(rec)
            print(f"  {shoe['id']:8s} {rec['action']:6s} {rec['width']}x{rec['height']} "
                  f"{human(sum(rec['files'].values()))}", flush=True)

    if args.only in ("all", "videos"):
        print("Videos", flush=True)
        for shoe in SHOES:
            for label, info in shoe["clips"].items():
                rec = process_video(shoe, label, info)
                rec["shoe"] = shoe["id"]
                rec["name"] = shoe["name"]
                rec["label"] = label
                videos.append(rec)
                print(f"  {shoe['id']:8s} {label:9s} {rec['action']:24s} "
                      f"{human(sum(rec['files'].values()))}", flush=True)

    if args.only in ("all", "frames"):
        print("Frame sequences", flush=True)
        for shoe in SHOES:
            if not shoe["hero"]:
                continue
            mp4 = SHOES_DIR / shoe["id"] / "360.mp4"
            if not mp4.exists():
                raise SystemExit(f"missing 360.mp4 for {shoe['id']}; run --only videos first")
            frame_sets[shoe["id"]] = extract_frames(shoe, mp4)
            d = frame_sets[shoe["id"]]["desktop"]
            m = frame_sets[shoe["id"]]["mobile"]
            print(f"  {shoe['id']:8s} desktop={d['count']} ({human(d['bytes'])}) "
                  f"mobile={m['count']} ({human(m['bytes'])})", flush=True)

    proofs = []
    if stills:
        proofs += make_still_corner_sheet(stills)
    if videos:
        proofs += make_video_proofs(videos)
        proofs += make_clean_corner_sheet(videos)

    image_scan = {rec["id"]: rec for rec in stills}
    video_scan = {f"{rec['shoe']}/{rec['label']}": rec for rec in videos}
    residual = {f"{rec['shoe']}/{rec['label']}": rec["residual"] for rec in videos}

    (VERIFY / "image_scan.json").write_text(json.dumps(image_scan, indent=2), encoding="utf-8")
    (VERIFY / "video_scan.json").write_text(json.dumps(video_scan, indent=2), encoding="utf-8")
    (VERIFY / "video_residual.json").write_text(json.dumps(residual, indent=2), encoding="utf-8")

    by_kind = {"stills": 0, "videos": 0, "frames": 0}
    for rec in stills:
        by_kind["stills"] += sum(rec["files"].values())
    for rec in videos:
        by_kind["videos"] += sum(rec["files"].values())
    for data in frame_sets.values():
        by_kind["frames"] += data["desktop"]["bytes"] + data["mobile"]["bytes"]
    total_files = sum(1 for p in PUBLIC.rglob("*") if p.is_file())
    total_bytes = sum(p.stat().st_size for p in PUBLIC.rglob("*") if p.is_file())
    report = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "elapsed_seconds": round(time.time() - started, 1),
        "shoes": {
            shoe["id"]: {
                "name": shoe["name"],
                "still": next((r for r in stills if r["id"] == shoe["id"]), None),
                "videos": {
                    label: next((r for r in videos if r["shoe"] == shoe["id"] and r["label"] == label), None)
                    for label in shoe["clips"]
                },
                "frames": frame_sets.get(shoe["id"]),
            }
            for shoe in SHOES
        },
        "totals": {
            "files": total_files,
            "bytes": total_bytes,
            "by_kind": by_kind,
        },
        "proofs": proofs,
    }
    (VERIFY / "build_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("", flush=True)
    print(f"AERO asset build complete in {report['elapsed_seconds']}s", flush=True)
    print(f"  stills  {human(by_kind['stills'])}", flush=True)
    print(f"  videos  {human(by_kind['videos'])}", flush=True)
    print(f"  frames  {human(by_kind['frames'])}", flush=True)
    print(f"  public  {human(total_bytes)} across {total_files} files", flush=True)
    print(f"  report  public/_verification/build_report.json", flush=True)


if __name__ == "__main__":
    main()
