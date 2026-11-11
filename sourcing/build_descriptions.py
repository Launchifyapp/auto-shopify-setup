#!/usr/bin/env python3
"""Build Shopify description HTML for the new products, in the same structure as public/products.csv.

Outputs (next to this script):
- descriptions-nouveaux-produits.csv  Niche;Rôle;Handle;Title;Body (HTML)
- medias-a-produire.csv              files to create per product (video, 4 icons, 2 visuals)
- apercu-descriptions.html           local preview with placeholders for missing media
It also rewrites the Produit column of produits-niches-aliexpress.csv and adds the Handle column.
"""
import csv, html, sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from descriptions_data import P, NICHES, SOURCES  # noqa: E402

STUDY_FIELDS = [
    ("note", "Avis clients"),
    ("cible", "Qui achète"),
    ("probleme", "Frustration"),
    ("declic", "Déclic d'achat"),
    ("adorent", "Ce qu'ils adorent"),
    ("objection", "Objection à lever"),
    ("angle", "Angle de vente"),
    ("alerte", "Alerte"),
]

MEDIA = "https://launchify.tech/media"
LOCAL_MEDIA = HERE.parent / "public" / "media"


def media(handle):
    has_video = (LOCAL_MEDIA / "videos" / f"{handle}-video.mp4").exists()
    return {
        # Products without a supplier video show a third photo in the same spot
        "video": f"{MEDIA}/videos/{handle}-video.mp4" if has_video else None,
        "stand_in": None if has_video else f"{MEDIA}/images/{handle}-visuel-0.jpg",
        "icons": [f"{MEDIA}/images/{handle}-icon-{i}.png" for i in range(1, 5)],
        "visuals": [f"{MEDIA}/images/{handle}-visuel-{i}.jpg" for i in range(1, 3)],
    }


def body(p):
    e = lambda s: html.escape(s, quote=False)  # keep apostrophes readable in the Shopify editor
    m = media(p["handle"])
    if m["video"]:
        top = f'<video style="display:block;margin:auto;max-width:340px;max-height:340px;border-radius:10px;object-fit:contain;" src="{m["video"]}" playsinline autoplay muted loop></video>'
    else:
        top = f'<img src="{m["stand_in"]}" width="340" height="340" style="display:block;margin:auto;border-radius:10px;">'
    out = [
        '<h2 style="text-align:center;"><br></h2>',
        f'<h2 style="text-align:center;"><strong>{e(p["hook"])}</strong></h2>',
        '<h2 style="text-align:center;"><br></h2>',
        "",
        "<p>",
        top,
        "</p>",
        "",
        "<p></p><p></p>",
    ]
    for i, ((title, text), icon) in enumerate(zip(p["icons"], m["icons"]), 1):
        out += [
            "",
            f"<!-- ICON {i} -->",
            '<div style="text-align:center;">',
            f'  <img src="{icon}" width="70" height="70" style="margin-bottom:16px;float:none;">',
            "</div>",
            f'<div style="text-align:center;"><strong>{e(title)}</strong></div>',
            f'<div style="text-align:center;">{e(text)}</div>',
            "",
            "<br>",
        ]
    for i, ((h2, para), visual) in enumerate(zip((p["s1"], p["s2"]), m["visuals"]), 5):
        out += [
            "",
            f"<!-- IMAGE {i} — 350px -->",
            '<div style="text-align:center;">',
            f'  <img src="{visual}" width="350" height="350" style="margin-bottom:16px;float:none;">',
            "</div>",
            "",
            f'<h2 style="text-align:center;">{e(h2)}</h2>',
            f"<p>{e(para)}</p>",
            "",
            "<p></p><p></p>",
        ]
    # Drop the trailing spacer after the last section
    while out and out[-1] in ("", "<p></p><p></p>"):
        out.pop()
    return "\n".join(out) + "\n"


def main():
    rows = [(p["niche"], p["role"], p["handle"], p["title"], body(p)) for p in P]

    with open(HERE / "descriptions-nouveaux-produits.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Niche", "Rôle", "Handle", "Title", "Body (HTML)"])
        w.writerows(rows)

    import json
    from icon_map import ICONS
    from media_picks import VISUALS, EXTRA_VIDEOS
    sources = json.loads((HERE / "media_sources.json").read_text())
    ali_img = "https://ae-pic-a1.aliexpress-media.com/kf/"
    ali_vid = "https://video.aliexpress-media.com/play/u/"

    def gallery(handle):
        return sources[handle][0].split(",")

    def spare_index(handle):
        return next(i for i in range(1, 7) if i not in VISUALS[handle] and i <= len(gallery(handle)))

    def video_source(handle):
        return EXTRA_VIDEOS.get(handle) or sources[handle][1]

    from google_picks import PICKS as _gp
    _gc = json.loads((HERE / "google_candidates.json").read_text())

    def visual_source(handle, n):
        if handle in _gp:
            return _gc[handle][_gp[handle][n] - 1][0]
        return ali_img + gallery(handle)[VISUALS[handle][n] - 1]

    (HERE / "medias-a-produire.csv").unlink(missing_ok=True)
    with open(HERE / "medias.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Niche", "Handle", "Produit", "Vidéo", "Source vidéo", "Icônes (Tabler)",
                    "Visuel 1 (source)", "Visuel 2 (source)", "Photo à la place de la vidéo (source)"])
        for p in P:
            h = p["handle"]
            m = media(h)
            g = gallery(h)
            w.writerow([
                p["niche"], h, p["title"],
                f"{h}-video.mp4" if m["video"] else "Aucune vidéo fournisseur : photo à la place",
                ali_vid + video_source(h) if m["video"] else "",
                ", ".join(ICONS[h]),
                visual_source(h, 0), visual_source(h, 1),
                "" if m["video"] else ali_img + g[spare_index(h) - 1],
            ])

    with open(HERE / "etude-de-marche.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Niche", "Rôle", "Handle", "Produit"] + [label for _, label in STUDY_FIELDS])
        for p in P:
            w.writerow([p["niche"], p["role"], p["handle"], p["title"]] + [p["study"].get(k, "") for k, _ in STUDY_FIELDS])

    # Keep the sourcing sheet aligned with the descriptions (same order, same names)
    src = HERE / "produits-niches-aliexpress.csv"
    with open(src, encoding="utf-8-sig", newline="") as f:
        sheet = list(csv.reader(f, delimiter=";"))
    head, data = sheet[0], sheet[1:]
    assert len(data) == len(P)
    if "Handle" not in head:
        head = head[:3] + ["Handle"] + head[3:]
        data = [r[:3] + [""] + r[3:] for r in data]
    from data_remplacements import SOURCING

    def fmt(x):
        return f"{x:.2f}".replace(".", ",")

    def sale_price(cost):
        for s in (9.99, 12.99, 14.99, 16.99, 19.99, 24.99, 29.99, 34.99, 39.99, 44.99, 49.99,
                  54.99, 59.99, 64.99, 69.99, 74.99, 79.99):
            if s >= 4 * cost:
                return s
        raise ValueError(cost)

    for r, p in zip(data, P):
        assert (r[0], r[1]) == (p["niche"], p["role"]), (r[:3], p["handle"])
        r[2], r[3] = p["title"], p["handle"]
        if p["handle"] in SOURCING:
            price, orders, item_id, wow, fame = SOURCING[p["handle"]]
            cost = round(price + (2.0 if price < 10 else 0.0), 2)  # buffer: free shipping only from 10 €
            sale = sale_price(cost)
            r[4:] = [fmt(price), fmt(cost), fmt(sale), f"x{sale / cost:.1f}", orders, fame, wow,
                     f"Remplace « {p['replaces']} »", f"https://fr.aliexpress.com/item/{item_id}.html"]
    with open(src, "w", encoding="utf-8-sig", newline="") as f:
        csv.writer(f, delimiter=";").writerows([head] + data)

    # Local preview, one file per niche: icons embedded as small thumbnails, photos and videos
    # loaded from the supplier CDN (the launchify.tech copies are only online after a deploy).
    import base64, subprocess
    cache = HERE / ".cache-preview"
    cache.mkdir(exist_ok=True)

    def icon_uri(name):
        thumb = cache / name
        if not thumb.exists():
            subprocess.run(["sips", "-Z", "70", str(LOCAL_MEDIA / "images" / name), "--out", str(thumb)],
                           check=True, stdout=subprocess.DEVNULL)
        return "data:image/png;base64," + base64.b64encode(thumb.read_bytes()).decode()

    from google_picks import PICKS as GPICKS, FLAGS as GFLAGS, MODEL_CHECK
    gcands = json.loads((HERE / "google_candidates.json").read_text())

    def preview_body(h, b):
        g = gallery(h)
        swaps = {f"{MEDIA}/images/{h}-icon-{i}.png": icon_uri(f"{h}-icon-{i}.png") for i in range(1, 5)}
        for n, i in enumerate(VISUALS[h], 1):
            swaps[f"{MEDIA}/images/{h}-visuel-{n}.jpg"] = ali_img + g[i - 1]
        for n, i in enumerate(GPICKS.get(h, ()), 1):  # Google Images picks replace the supplier photos
            swaps[f"{MEDIA}/images/{h}-visuel-{n}.jpg"] = gcands[h][i - 1][0]
        if media(h)["video"]:
            swaps[f"{MEDIA}/videos/{h}-video.mp4"] = ali_vid + video_source(h)
        else:
            swaps[f"{MEDIA}/images/{h}-visuel-0.jpg"] = ali_img + g[spare_index(h) - 1]
        for k, v in swaps.items():
            b = b.replace(k, v)
        return b

    for old in HERE.glob("apercu-*.html"):
        old.unlink()
    e = html.escape
    pages = {}
    for p, (niche, role, handle, title, b) in zip(P, rows):
        cards = pages.setdefault(niche, [])
        if not cards:
            ctx = NICHES[niche]
            cards.append(f'<section class="niche"><h2>{e(niche)}</h2><p>{e(ctx["contexte"])}</p>'
                         f'<p><b>Leviers d\'achat :</b> {e(ctx["leviers"])}</p></section>')
        b = preview_body(handle, b)
        st = p["study"]
        rows_html = "".join(
            f'<dt>{e(label)}</dt><dd>{e(st[k])}</dd>' for k, label in STUDY_FIELDS if st.get(k)
        )
        alert = f'<p class="alert">⚠ {e(st["alerte"])}</p>' if st.get("alerte") else ""
        if handle in GFLAGS:
            alert += f'<p class="alert">📷 Images à revoir : {e(GFLAGS[handle])}</p>'
        elif handle in MODEL_CHECK:
            alert += '<p class="alert">📷 Vérifier que les photos montrent bien le modèle livré par le fournisseur.</p>'
        cards.append(
            f'<article><header><span class="tag">{niche} · {role}</span><h1>{e(title)}</h1>'
            f'<code>{handle}</code></header>{alert}'
            f'<details class="study"><summary>Étude de marché</summary><dl>{rows_html}</dl></details>'
            f'<div class="rte">{b}</div></article>'
        )
    refs = "".join(f'<li><a href="{u}">{e(t)}</a></li>' for t, u in SOURCES)
    footer = (f'<section class="niche"><h2>Sources</h2><p>Avis clients AliExpress et Amazon.fr relevés le 9 novembre 2026. '
              f'Icônes : Tabler Icons (licence MIT). Photos et vidéos : annonces fournisseurs AliExpress.</p><ul>{refs}</ul></section>')
    for niche, cards in pages.items():
        slug = {"Animaux": "animaux", "Bien-être": "bien-etre", "Maison": "maison", "Sport": "sport"}[niche]
        write_preview(HERE / f"apercu-{slug}.html", f"Aperçu {niche}", cards + [footer])
    print(f"{len(rows)} descriptions written")


def write_preview(path, title, cards):
    preview = f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>
:root{{--bg:#f6f4f1;--card:#fff;--fg:#1d1b19;--muted:#6b6560;--line:#e6e1db;--ph:#efe9e2}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151413;--card:#1f1d1b;--fg:#f1ede8;--muted:#a49c94;--line:#34302c;--ph:#2b2825}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,system-ui,sans-serif}}
main{{max-width:620px;margin:0 auto;padding:24px 16px;display:grid;gap:24px}}
article{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}}
header h1{{font-size:20px;margin:4px 0}} header code{{color:var(--muted);font-size:12px}}
.tag{{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}}
.rte h2{{font-size:19px;line-height:1.3}} .rte img,.rte video{{display:block;margin-inline:auto;max-width:100%}}
.niche{{background:transparent;padding:8px 4px}} .niche h2{{font-size:24px;margin:8px 0}} .niche a{{color:inherit}}
.study{{margin:12px 0 4px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13.5px}}
.study summary{{cursor:pointer;font-weight:600}} .study dt{{font-weight:600;margin-top:8px}} .study dd{{margin:2px 0 0;color:var(--muted)}}
.alert{{background:#fdecc8;color:#5c3b00;border-radius:8px;padding:8px 10px;font-size:13.5px;margin:10px 0 0}}
@media (prefers-color-scheme:dark){{.alert{{background:#4a3510;color:#ffe2a8}}}}
.ph{{display:flex;align-items:center;justify-content:center;margin:0 auto 16px;background:var(--ph);
  color:var(--muted);border-radius:10px;font-size:11px;text-align:center;padding:4px;box-sizing:border-box}}
</style></head><body><main>{''.join(cards)}</main>
<script>
function ph(el){{const w=+el.getAttribute('width')||340,h=+el.getAttribute('height')||340;
 const d=document.createElement('div');d.className='ph';d.style.width=Math.min(w,340)+'px';d.style.height=Math.min(h,340)+'px';
 d.textContent=(el.getAttribute('src')||'').split('/').pop();el.replaceWith(d)}}
document.querySelectorAll('.rte img').forEach(i=>{{i.addEventListener('error',()=>ph(i));if(i.complete&&!i.naturalWidth)ph(i)}});
document.querySelectorAll('.rte video').forEach(v=>v.addEventListener('error',()=>ph(v),true));
</script></body></html>"""
    path.write_text(preview, encoding="utf-8")


if __name__ == "__main__":
    main()
