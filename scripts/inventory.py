"""Inventory the raw asset drop. Writes scripts/inventory.json and prints a summary."""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
COLORS = {"blue": "BLUE SHOE", "brown": "BROWN_SHOE", "black": "BLACK_SHOE"}
VIDEO_ROLES = ["reveal", "360", "parts", "close up"]

report = {"frames": {}, "videos": [], "stills": [], "notes": []}

for color, folder in COLORS.items():
    src = ROOT / "assets" / color / "source_frames"
    files = sorted(src.glob("*.jpg"))
    nums = sorted(int(f.stem.split("_")[1]) for f in files)
    missing = [n for n in range(1, 241) if n not in nums]
    sizes = {}
    for f in files[::20]:
        with Image.open(f) as im:
            sizes[str(im.size)] = sizes.get(str(im.size), 0) + 1
    report["frames"][color] = {
        "source_folder": folder,
        "count": len(files),
        "first": files[0].name if files else None,
        "last": files[-1].name if files else None,
        "missing": missing,
        "dimensions_sample": sizes,
    }
    if missing:
        report["notes"].append(f"{color}: missing frames {missing}")

    for f in sorted((ROOT / folder).glob("*.mp4")):
        report["videos"].append({"color": color, "file": f.name, "bytes": f.stat().st_size})
    for f in sorted((ROOT / folder).glob("*.jpeg")):
        try:
            with Image.open(f) as im:
                size = im.size
        except Exception:
            size = None
        report["stills"].append({"color": color, "file": f.name, "bytes": f.stat().st_size, "size": size})

out = ROOT / "scripts" / "inventory.json"
out.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
