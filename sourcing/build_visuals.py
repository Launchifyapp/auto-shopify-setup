#!/usr/bin/env python3
"""Turn the chosen supplier photos into square JPEG description visuals in public/media/images.

- <handle>-visuel-1.jpg and -visuel-2.jpg: the two photos chosen in media_picks.py
- <handle>-visuel-0.jpg: only for products without a video, the first unused gallery photo (shown instead of the video)
Uses macOS sips: centered square crop, max 1200 px, JPEG quality 85.
"""
import subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from media_picks import VISUALS  # noqa: E402

RAW = HERE / "raw"
IMAGES = HERE.parent / "public" / "media" / "images"
VIDEOS = HERE.parent / "public" / "media" / "videos"


def source(handle, i):
    found = sorted((RAW / handle).glob(f"g{i}.*"))
    if not found:
        raise FileNotFoundError(f"{handle} g{i}")
    return found[0]


def to_square_jpeg(src, out):
    w, h = (int(v) for v in subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(src)], capture_output=True, text=True, check=True
    ).stdout.split()[-3::2])
    side = min(w, h, 1200)
    tmp = out.with_suffix(".tmp.jpg")
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", str(src), "--out", str(tmp)],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["sips", "-c", str(min(w, h)), str(min(w, h)), str(tmp)], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["sips", "-Z", str(side), str(tmp), "--out", str(out)], check=True, stdout=subprocess.DEVNULL)
    tmp.unlink()


def main():
    no_video = []
    for handle, picks in VISUALS.items():
        for n, i in enumerate(picks, 1):
            to_square_jpeg(source(handle, i), IMAGES / f"{handle}-visuel-{n}.jpg")
        if not (VIDEOS / f"{handle}-video.mp4").exists():
            spare = next(i for i in range(1, 7) if i not in picks and list((RAW / handle).glob(f"g{i}.*")))
            to_square_jpeg(source(handle, spare), IMAGES / f"{handle}-visuel-0.jpg")
            no_video.append(handle)
    print(f"{len(VISUALS) * 2} visuals, {len(no_video)} video stand-ins")


if __name__ == "__main__":
    main()
