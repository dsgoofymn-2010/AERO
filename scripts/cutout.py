"""Build transparent shoe cutouts for the Hangar showroom.

Reads js/data.js (via node) so filenames are never hardcoded, strips the studio
background, and writes public/showroom/<id>.webp plus an 800px mobile variant.

    python scripts/cutout.py                 # all shoes, best available backend
    python scripts/cutout.py --only loom     # one shoe
    python scripts/cutout.py --backend opencv
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "showroom"
VERIFY_DIR = ROOT / "public" / "_verification"

DESKTOP_MAX = 1600
MOBILE_MAX = 800
PAD_RATIO = 0.02
# The shoe fills only part of a 1599x893 source, so a tight crop lands near
# 800px. Allow Lanczos up to 2x to reach the 1600px focus texture; past that the
# resample is all guesswork and only costs bytes.
MAX_UPSCALE = 2.0

# Picked by eye off a contact sheet of each sequence: the frame where the toe
# points right and the toe box is turned ~45 deg toward camera, matching the
# angle the ten gallery stills were shot at.
FRAME_PICKS = {"blue": 213, "brown": 190, "black": 188}

# Which sequences are real turntables. Blue's clip is a flythrough reveal, not
# a rotation: its first ~155 frames are underlit and full of particle FX, and
# the clean tail barely turns. It gets the gallery treatment in focus instead.
TURNTABLES = ("brown", "black")

# Veo wordmark / Gemini sparkle sit in this corner box when present.
WATERMARK_BOX = 0.08


def load_shoes() -> list[dict]:
    script = "import {SHOES} from './js/data.js'; process.stdout.write(JSON.stringify(SHOES));"
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def source_for(shoe: dict) -> Path:
    """Video shoes take a cleaned 360 frame; gallery shoes take the original still."""
    if shoe["type"] == "video":
        frames = ROOT / shoe["assets"]["frames"]["desktop"]
        return frames / f"frame_{FRAME_PICKS[shoe['id']]:03d}.webp"
    original = ROOT / shoe["source"]["still"]
    return original if original.exists() else ROOT / shoe["assets"]["still"]


def find_watermark(bgr: np.ndarray) -> np.ndarray | None:
    """Return a dilated mask of bright marks in the bottom-right box, or None."""
    h, w = bgr.shape[:2]
    y0, x0 = int(h * (1 - WATERMARK_BOX)), int(w * (1 - WATERMARK_BOX))
    patch = cv2.cvtColor(bgr[y0:, x0:], cv2.COLOR_BGR2GRAY)
    # The mark is brighter and harder-edged than the smooth studio falloff.
    blurred = cv2.GaussianBlur(patch, (0, 0), 9)
    hot = ((patch.astype(np.int16) - blurred.astype(np.int16)) > 22).astype(np.uint8)
    if int(hot.sum()) < 40:
        return None
    mask = np.zeros((h, w), np.uint8)
    mask[y0:, x0:] = cv2.dilate(hot * 255, np.ones((5, 5), np.uint8), iterations=2)
    return mask


def largest_blob(mask: np.ndarray) -> np.ndarray:
    """Drop floor reflections and speckle; the shoe is always the biggest piece."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 127).astype(np.uint8), 8)
    if count <= 1:
        return mask
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.where(labels == keep, mask, 0).astype(np.uint8)


def fill_holes(mask: np.ndarray) -> np.ndarray:
    binary = (mask > 127).astype(np.uint8) * 255
    flood = binary.copy()
    pad = np.zeros((binary.shape[0] + 2, binary.shape[1] + 2), np.uint8)
    cv2.floodFill(flood, pad, (0, 0), 255)
    return cv2.bitwise_or(binary, cv2.bitwise_not(flood))


def alpha_rembg(bgr: np.ndarray, session) -> np.ndarray:
    from rembg import remove

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return remove(rgb, session=session, only_mask=True, post_process_mask=True)


def studio_background(bgr: np.ndarray) -> np.ndarray:
    """Fit the smooth studio vignette from the border ring as a quadratic surface.

    Plain flood fill walks through the low-contrast edges of the black oxford and
    the brown boot. Subtracting a modelled gradient leaves the shoe as the only
    strong deviation, whatever the backdrop falloff does.
    """
    h, w = bgr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx /= w
    yy /= h
    basis = np.stack([np.ones_like(xx), xx, yy, xx * xx, xx * yy, yy * yy], -1)

    ring = np.zeros((h, w), bool)
    m = max(3, int(min(h, w) * 0.035))
    ring[:m, :] = ring[-m:, :] = ring[:, :m] = ring[:, -m:] = True

    out = np.empty_like(bgr, np.float32)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(basis[ring], bgr[:, :, c][ring].astype(np.float32), rcond=None)
        out[:, :, c] = basis @ coef
    return out


def alpha_opencv(bgr: np.ndarray) -> np.ndarray:
    """Background-model threshold for a seed, then GrabCut for the real edge."""
    h, w = bgr.shape[:2]
    diff = np.abs(bgr.astype(np.float32) - studio_background(bgr)).max(-1)
    seed = (cv2.GaussianBlur(diff, (0, 0), 2.0) > 16).astype(np.uint8) * 255
    seed = cv2.morphologyEx(seed, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    seed = cv2.morphologyEx(seed, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    seed = fill_holes(largest_blob(seed))
    if seed.max() == 0:
        return seed

    k = max(5, int(min(h, w) * 0.012)) | 1
    inner = cv2.erode(seed, np.ones((k, k), np.uint8))
    near = cv2.dilate(seed, np.ones((k * 3, k * 3), np.uint8))

    gc = np.full((h, w), cv2.GC_BGD, np.uint8)
    gc[near > 0] = cv2.GC_PR_BGD
    gc[seed > 0] = cv2.GC_PR_FGD
    gc[inner > 0] = cv2.GC_FGD
    cv2.grabCut(bgr, gc, None, np.zeros((1, 65), np.float64),
                np.zeros((1, 65), np.float64), 3, cv2.GC_INIT_WITH_MASK)

    mask = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return fill_holes(largest_blob(mask))


def cut_shadow(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Drop the studio contact shadow and floor reflection from the mask.

    A shadow is the backdrop dimmed, so it holds the backdrop's channel ratio.
    Shoe material either breaks that ratio (anything coloured) or sits far
    darker than the dim band (the black oxford, rubber outsoles).
    """
    ratio = bgr.astype(np.float32) / np.maximum(studio_background(bgr), 1.0)
    level = ratio.mean(-1)
    shadowy = ((ratio.max(-1) - ratio.min(-1)) < 0.10) & (level > 0.45) & (level < 1.06)

    # Polished black leather is achromatic too, so two more gates: a shadow is
    # blur-smooth (lug outsoles are not) and it pools under the shoe, never up
    # in the upper.
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mean = cv2.blur(grey, (9, 9))
    shadowy &= cv2.blur(grey * grey, (9, 9)) - mean * mean < 36.0

    ys = np.nonzero((mask > 127).any(1))[0]
    if len(ys):
        floor = np.zeros(mask.shape, bool)
        floor[int(ys.min() + 0.65 * (ys.max() - ys.min())):] = True
        shadowy &= floor

    core = ((mask > 127) & ~shadowy).astype(np.uint8) * 255
    core = cv2.morphologyEx(core, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    core = largest_blob(core)
    if core.max() == 0:
        return mask
    # Grey outsoles read as shadow too, so hand back a margin around the body;
    # the detached reflection sits well outside it and stays cut.
    r = max(5, int(min(mask.shape) * 0.008)) | 1
    grown = cv2.dilate(core, np.ones((r, r), np.uint8))
    return fill_holes(largest_blob(cv2.bitwise_and(mask, grown)))


def bleed_edges(bgr: np.ndarray, alpha: np.ndarray, radius: int = 4) -> np.ndarray:
    """Push opaque colour into the soft rim so no grey halo survives on a dark backdrop."""
    core = (alpha >= 250).astype(np.uint8)
    if core.sum() == 0:
        return bgr
    dist, labels = cv2.distanceTransformWithLabels(
        1 - core, cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL
    )
    ys, xs = np.nonzero(core)
    lut = np.zeros(int(labels.max()) + 1, np.int64)
    lut[labels[ys, xs]] = np.arange(len(ys))
    idx = lut[labels]
    nearest = bgr[ys[idx], xs[idx]]
    return np.where(((dist <= radius) & (core == 0))[..., None], nearest, bgr)


def tight_crop(rgba: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(rgba[:, :, 3] > 6)
    if len(ys) == 0:
        return rgba
    h, w = rgba.shape[:2]
    pad = int(max(h, w) * PAD_RATIO)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    return rgba[y0:y1, x0:x1]


def save_webp(rgba: np.ndarray, path: Path, long_edge: int, allow_upscale: bool = False) -> tuple[int, int, int]:
    im = Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA), "RGBA")
    cap = MAX_UPSCALE if allow_upscale else 1.0
    scale = min(cap, long_edge / max(im.width, im.height))
    if abs(scale - 1.0) > 0.01:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=90, method=6, alpha_quality=100)
    return im.width, im.height, path.stat().st_size


def process(shoe: dict, session, backend: str, report: dict, keep_shadow: bool = False) -> dict:
    src = source_for(shoe)
    bgr = cv2.imread(str(src), cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"cannot read {src}")

    corner_before = corner_crop(bgr)
    wm = find_watermark(bgr)
    if wm is not None:
        bgr = cv2.inpaint(bgr, wm, 4, cv2.INPAINT_TELEA)

    alpha = alpha_rembg(bgr, session) if backend == "rembg" else alpha_opencv(bgr)
    alpha = largest_blob(fill_holes(largest_blob(alpha)))
    if not keep_shadow:
        alpha = cut_shadow(bgr, alpha)
    # Erode a hair before feathering so the feather lands on shoe, not background.
    alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(alpha, (0, 0), 1.1)

    rgba = np.dstack([bleed_edges(bgr, alpha), alpha])
    rgba = tight_crop(rgba)

    native_h, native_w = rgba.shape[:2]
    w1, h1, b1 = save_webp(rgba, OUT_DIR / f"{shoe['id']}.webp", DESKTOP_MAX, allow_upscale=True)
    w2, h2, b2 = save_webp(rgba, OUT_DIR / f"{shoe['id']}-800.webp", MOBILE_MAX)

    report["corners"].append((shoe["id"], corner_before, corner_crop(bgr)))
    return {
        "id": shoe["id"], "name": shoe["name"], "type": shoe["type"],
        "accent": shoe["accent"], "backend": backend,
        "source": str(src.relative_to(ROOT)).replace("\\", "/"),
        "watermark": bool(wm is not None),
        "src": f"public/showroom/{shoe['id']}.webp",
        "srcMobile": f"public/showroom/{shoe['id']}-800.webp",
        "width": w1, "height": h1, "aspect": round(w1 / h1, 4),
        "nativeWidth": native_w, "nativeHeight": native_h,
        "bytes": b1, "bytesMobile": b2, "mobileWidth": w2, "mobileHeight": h2,
    }


def corner_crop(bgr: np.ndarray) -> np.ndarray:
    h, w = bgr.shape[:2]
    return bgr[int(h * (1 - WATERMARK_BOX)):, int(w * (1 - WATERMARK_BOX)):].copy()


def write_contact_sheet(entries: list[dict], path: Path) -> None:
    """Cutouts over a checkerboard so stray background and halos are obvious."""
    cell, cols = 420, 5
    rows = -(-len(entries) // cols)
    board = np.zeros((rows * cell, cols * cell, 3), np.uint8)
    sq = 20
    for y in range(0, board.shape[0], sq):
        for x in range(0, board.shape[1], sq):
            board[y:y + sq, x:x + sq] = 92 if ((x // sq + y // sq) % 2) else 56

    for i, e in enumerate(entries):
        im = cv2.imread(str(ROOT / e["src"]), cv2.IMREAD_UNCHANGED)
        s = min((cell - 40) / im.shape[1], (cell - 60) / im.shape[0])
        im = cv2.resize(im, (int(im.shape[1] * s), int(im.shape[0] * s)), interpolation=cv2.INTER_AREA)
        oy, ox = (i // cols) * cell + 40, (i % cols) * cell + (cell - im.shape[1]) // 2
        region = board[oy:oy + im.shape[0], ox:ox + im.shape[1]]
        a = (im[:, :, 3:4].astype(np.float32) / 255.0)
        board[oy:oy + im.shape[0], ox:ox + im.shape[1]] = (im[:, :, :3] * a + region * (1 - a)).astype(np.uint8)
        cv2.putText(board, f"{e['id']} {e['width']}x{e['height']}",
                    ((i % cols) * cell + 14, (i // cols) * cell + 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 220, 90), 1, cv2.LINE_AA)
    cv2.imwrite(str(path), board, [cv2.IMWRITE_JPEG_QUALITY, 88])


def write_corner_sheet(corners: list, path: Path) -> None:
    cell = 240
    board = np.full((len(corners) * (cell + 8) + 8, cell * 2 + 24, 3), 24, np.uint8)
    for i, (sid, before, after) in enumerate(corners):
        y = 8 + i * (cell + 8)
        for j, img in enumerate((before, after)):
            img = cv2.resize(img, (cell, cell), interpolation=cv2.INTER_NEAREST)
            board[y:y + cell, 8 + j * (cell + 8):8 + j * (cell + 8) + cell] = img
        cv2.putText(board, sid, (12, y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 220, 90), 1, cv2.LINE_AA)
    cv2.imwrite(str(path), board, [cv2.IMWRITE_JPEG_QUALITY, 92])


def frame_rgba(path: Path, session, backend: str, scale: float) -> np.ndarray | None:
    """One 360 frame through the same mask pipeline, kept at full frame size."""
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    if scale < 1.0:
        bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    alpha = alpha_rembg(bgr, session) if backend == "rembg" else alpha_opencv(bgr)
    alpha = largest_blob(fill_holes(largest_blob(alpha)))
    alpha = cut_shadow(bgr, alpha)
    if alpha.max() == 0:
        return None
    alpha = cv2.GaussianBlur(cv2.erode(alpha, np.ones((3, 3), np.uint8)), (0, 0), 1.1)
    return np.dstack([bleed_edges(bgr, alpha), alpha])


def build_frames(shoes: list[dict], session, backend: str, step: int, long_edge: int) -> dict:
    """Transparent turntables for the video shoes.

    The 360 frames still carry the studio backdrop, so dropping them on the dark
    wall would show a grey rectangle. Every frame is cropped to one box shared
    by the whole sequence, otherwise a per-frame tight crop makes the shoe jump
    as it turns.
    """
    out = {}
    for shoe in shoes:
        if shoe["type"] != "video":
            continue
        if shoe["id"] not in TURNTABLES:
            print(f"{shoe['id']}: not a turntable sequence, skipped")
            continue
        src_dir = ROOT / shoe["assets"]["frames"]["desktop"]
        frames = sorted(src_dir.glob("frame_*.webp"))
        if not frames:
            print(f"{shoe['id']}: no frames at {src_dir}")
            continue

        picked = frames[::step]
        probe = cv2.imread(str(picked[0]), cv2.IMREAD_COLOR)
        scale = min(1.0, (long_edge * 1.7) / max(probe.shape[:2]))

        stack = []
        for i, frame in enumerate(picked):
            rgba = frame_rgba(frame, session, backend, scale)
            if rgba is not None:
                stack.append(rgba)
            print(f"  {shoe['id']} {i + 1}/{len(picked)}", flush=True)
        if not stack:
            continue

        union = np.zeros(stack[0].shape[:2], np.uint8)
        for rgba in stack:
            union = np.maximum(union, rgba[:, :, 3])
        ys, xs = np.nonzero(union > 6)
        pad = int(max(union.shape) * PAD_RATIO)
        y0, y1 = max(0, ys.min() - pad), min(union.shape[0], ys.max() + 1 + pad)
        x0, x1 = max(0, xs.min() - pad), min(union.shape[1], xs.max() + 1 + pad)

        dest = OUT_DIR / "frames" / shoe["id"]
        dest.mkdir(parents=True, exist_ok=True)
        for old in dest.glob("f_*.webp"):
            old.unlink()

        written = []
        for i, rgba in enumerate(stack):
            w, h, size = save_webp(rgba[y0:y1, x0:x1], dest / f"f_{i:03d}.webp", long_edge)
            written.append(size)

        out[shoe["id"]] = {
            "dir": f"public/showroom/frames/{shoe['id']}",
            "pattern": "f_%03d.webp",
            "count": len(written),
            "step": step,
            "sourceCount": len(frames),
            "width": w,
            "height": h,
            "aspect": round(w / h, 4),
            "bytes": sum(written),
        }
        print(f"{shoe['id']}: {len(written)} frames {w}x{h}, {sum(written) / 1024 / 1024:.2f} MB")
    return out


def pick_backend(requested: str):
    if requested == "opencv":
        return "opencv", None
    try:
        from rembg import new_session
    except ImportError:
        if requested == "rembg":
            raise SystemExit("rembg not installed; run pip install rembg[cpu] or use --backend opencv")
        print("rembg unavailable, falling back to OpenCV")
        return "opencv", None
    for model in ("isnet-general-use", "u2net"):
        try:
            return "rembg", new_session(model)
        except Exception as exc:
            print(f"model {model} unavailable: {exc}")
    return "opencv", None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=("auto", "rembg", "opencv"), default="auto")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--keep-shadow", action="store_true", help="leave the contact shadow in the mask")
    ap.add_argument("--frames", type=int, default=0, metavar="STEP",
                    help="also build transparent 360 turntables, taking every STEP-th frame")
    ap.add_argument("--frame-size", type=int, default=900, help="long edge for turntable frames")
    ap.add_argument("--frames-only", action="store_true", help="skip the stills, rebuild turntables only")
    args = ap.parse_args()

    backend, session = pick_backend(args.backend)
    shoes = load_shoes()
    if args.only:
        shoes = [s for s in shoes if s["id"] in args.only]

    if args.frames_only:
        turntables = build_frames(shoes, session, backend, max(1, args.frames or 4), args.frame_size)
        path = OUT_DIR / "frames" / "manifest.json"
        path.write_text(json.dumps({"backend": backend, "turntables": turntables}, indent=2), encoding="utf-8")
        print(f"turntables -> {path}")
        return

    report: dict = {"corners": []}
    entries = []
    for shoe in shoes:
        entry = process(shoe, session, backend, report, args.keep_shadow)
        entries.append(entry)
        print(f"{entry['id']:<8} {entry['width']}x{entry['height']}  "
              f"{entry['bytes'] / 1024:6.1f} KB  watermark={entry['watermark']}  {entry['source']}")

    VERIFY_DIR.mkdir(parents=True, exist_ok=True)
    write_contact_sheet(entries, VERIFY_DIR / "showroom-contactsheet.jpg")
    write_corner_sheet(report["corners"], VERIFY_DIR / "showroom-corners.jpg")
    (OUT_DIR / "manifest.json").write_text(
        json.dumps({"generator": "scripts/cutout.py", "backend": backend,
                    "shoes": entries, "turntables": turntables}, indent=2),
        encoding="utf-8",
    )
    turntables = {}
    if args.frames:
        turntables = build_frames(shoes, session, backend, args.frames, args.frame_size)

    total = sum(e["bytes"] + e["bytesMobile"] for e in entries)
    print(f"\n{len(entries)} cutouts, {total / 1024 / 1024:.2f} MB total -> public/showroom/")


if __name__ == "__main__":
    main()
