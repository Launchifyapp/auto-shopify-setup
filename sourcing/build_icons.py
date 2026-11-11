#!/usr/bin/env python3
"""Render the Tabler icons chosen in icon_map.py as 512x512 black line PNGs in public/media/images.

Usage: python3 build_icons.py <work_dir>
Needs network access to api.iconify.design and macOS qlmanage (SVG rendering).
"""
import json, subprocess, sys, shutil, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from icon_map import ICONS  # noqa: E402

OUT = HERE.parent / "public" / "media" / "images"
STROKE = "1.05"  # matches the stroke weight of the existing catalog icons at 512px


def main(work):
    work = Path(work)
    svgs, pngs = work / "svg", work / "png"
    svgs.mkdir(parents=True, exist_ok=True)
    pngs.mkdir(parents=True, exist_ok=True)
    names = sorted({i for v in ICONS.values() for i in v})
    missing = [n for n in names if not (svgs / f"{n}.svg").exists()]
    if missing:
        # One batched request for all icon bodies (the per-icon endpoint is rate limited)
        req = urllib.request.Request("https://api.iconify.design/tabler.json?icons=" + ",".join(missing),
                                     headers={"User-Agent": "launchify-icon-builder/1.0"})
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
        size = data.get("width", 24)
        for n in missing:
            body = data["icons"][n]["body"]
            body = body.replace('stroke-width="2"', f'stroke-width="{STROKE}"').replace("currentColor", "#000")
            (svgs / f"{n}.svg").write_text(
                f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 {size} {size}">{body}</svg>')
    for name in names:
        svg = svgs / f"{name}.svg"
        png = pngs / f"{name}.svg.png"
        if not png.exists():
            subprocess.run(["qlmanage", "-t", "-s", "512", "-o", str(pngs), str(svg)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for handle, names in ICONS.items():
        for i, name in enumerate(names, 1):
            shutil.copyfile(pngs / f"{name}.svg.png", OUT / f"{handle}-icon-{i}.png")
            n += 1
    print(f"{n} icons written to {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
