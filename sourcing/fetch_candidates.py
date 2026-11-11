#!/usr/bin/env python3
"""Download Google Images candidates (google_candidates.json) and build contact sheets to pick visuals by eye.

Usage: python3 fetch_candidates.py <thumb_dir>
- originals: raw-google/<handle>/c<n>.<ext>   (git-ignored working files)
- sheets:    planches/google-<k>.html          (8 products per sheet, numbered thumbnails)
"""
import base64, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw-google"
cands = json.loads((HERE / "google_candidates.json").read_text())


def ext_of(url):
    tail = url.split("?")[0].rsplit(".", 1)[-1].lower()
    return tail if tail in ("jpg", "jpeg", "png", "webp") else "jpg"


def get(job):
    url, out = job
    if out.exists() and out.stat().st_size > 5000:
        return True
    r = subprocess.run(["curl", "-s", "-f", "-L", "--max-time", "25", "-A",
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
                        "-o", str(out), url])
    ok = r.returncode == 0 and out.exists() and out.stat().st_size > 5000
    if not ok and out.exists():
        out.unlink()
    return ok


def main(thumbs):
    thumbs = Path(thumbs)
    thumbs.mkdir(parents=True, exist_ok=True)
    jobs = []
    for h, lst in cands.items():
        (RAW / h).mkdir(parents=True, exist_ok=True)
        for n, (url, w, hh) in enumerate(lst, 1):
            jobs.append((url, RAW / h / f"c{n}.{ext_of(url)}"))
    with ThreadPoolExecutor(10) as ex:
        ok = list(ex.map(get, jobs))
    print(f"{sum(ok)}/{len(jobs)} downloaded")
    rows = []
    for h in cands:
        cells = []
        for f in sorted((RAW / h).glob("c*.*"), key=lambda p: int(p.stem[1:])):
            t = thumbs / f"{h}-{f.stem}.jpg"
            if not t.exists():
                subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "60", "-Z", "120", str(f), "--out", str(t)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if t.exists():
                uri = "data:image/jpeg;base64," + base64.b64encode(t.read_bytes()).decode()
                cells.append(f'<figure><img src="{uri}"><figcaption>{f.stem[1:]}</figcaption></figure>')
        rows.append(f'<div class="p"><b>{h}</b><div class="t">{"".join(cells)}</div></div>')
    out = HERE / "planches"
    for old in out.glob("google-*.html"):
        old.unlink()
    per = 5
    for k in range(0, len(rows), per):
        (out / f"google-{k // per + 1}.html").write_text(
            '<!doctype html><meta charset="utf-8"><style>body{font:10px system-ui;margin:3px;background:#fff;color:#111}'
            '.p{margin-bottom:4px}.t{display:flex;flex-wrap:wrap;gap:2px}figure{margin:0;position:relative}'
            'img{width:62px;height:62px;object-fit:cover;display:block}figcaption{position:absolute;top:0;left:0;background:#000;color:#fff;font-size:9px;padding:0 2px}</style>'
            + "".join(rows[k:k + per]))
    print("sheets:", len(range(0, len(rows), per)))


if __name__ == "__main__":
    main(sys.argv[1])
