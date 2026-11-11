#!/usr/bin/env python3
"""One product CSV per store niche: public/products-<niche>.csv (FR) and, where an English
catalog exists, public/products-<niche>-en.csv.

Each file lists 20 products, the 10 core products first, then the 10 upsells. The app imports
the first 10 for the basic plan and all 20 for premium (lib/setupShop.ts), so the order matters.

- Existing products: their rows are copied from public/products.csv (or products-en.csv) and
  only the Tags column changes (niche tag + "Best-seller" for core products).
- New products (sourcing/descriptions_data.py): built here, in the same Shopify format. Prices come
  from produits-niches-aliexpress.csv. Product photos: the supplier photos picked in product_photos.py,
  made square here as public/media/images/<handle>-photo-<n>.jpg (served from launchify.tech/media),
  then the two description visuals.

Run after build_descriptions.py, avis_acheteurs.py and avis_extraits.py.
"""
import csv, glob, io, json, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
PUBLIC = ROOT / "public"
sys.path.insert(0, str(HERE))
from descriptions_data import P  # noqa: E402
from media_picks import VISUALS  # noqa: E402
from google_picks import PICKS as GOOGLE_VISUALS  # noqa: E402
from product_photos import PHOTOS  # noqa: E402

MEDIA = "https://launchify.tech/media/images"
SUMMARY = "Avis acheteurs (product.metafields.launchify.buyer_summary)"
REVIEWS = "Avis publics (product.metafields.launchify.buyer_reviews)"
CORE_TAG = "Best-seller"  # the app creates a "best sellers" collection from it (lib/i18n.ts)

# Niche slug -> collection/tag name per language. Keep in sync with NICHES in lib/i18n.ts.
NICHE_TAG = {
    "beaute": {"fr": "Beauté & soins", "en": "Beauty & Care"},
    "bien-etre": {"fr": "Bien-être & relaxation", "en": "Wellness & Relaxation"},
    "maison": {"fr": "Maison & cocooning", "en": "Home & Comfort"},
    "animaux": {"fr": "Animaux", "en": "Pets"},
    "sport": {"fr": "Sport & fitness", "en": "Sport & Fitness"},
}
DATA_NICHE = {"Bien-être": "bien-etre", "Maison": "maison", "Animaux": "animaux", "Sport": "sport"}

# Existing products per niche (handles of public/products.csv), core then upsell.
# New products (descriptions_data.P) are appended after them: "Principal" -> core, "Upsell" -> upsell.
EXISTING = {
    "beaute": (
        ["dispositif-hydrafacial-portable-copy", "appareil-de-soin-tonifiant-visage", "eliminateur-de-points-noirs-a-ultrasons",
         "le-boucleur-5-en-1", "boucleur-automatique-sans-fil", "rape-a-pied-electrique", "le-lisseur-a-barbe",
         "fibres-capillaires", "rouleau-anti-cellulites", "stylo-anti-acne-a-lumiere-bleue"],
        ["stick-pour-les-yeux-au-retinol", "le-cube-de-glace-magique", "recourbe-cils-chauffant", "taille-sourcils-electrique",
         "le-stylo-magique-4-en-1-copy", "kit-de-frisage-sans-chaleur", "brosse-demelante",
         "kit-de-demarrage-blinger®-180-pierres", "nettoyeur-magique-de-pinceaux", "le-rasoir-4-en-1"],
    ),
    "bien-etre": (
        ["masseur-cervical", "masseur-oculaire-bluetooth", "masque-de-sommeil-avec-ecouteurs-integres",
         "diffuseur-volcanique", "semelles-chauffantes", "ceinture-menstruelle"],
        ["bonnet-anti-migraine", "semelles-4d"],
    ),
    "maison": (
        ["plante-en-levitation", "la-lampe-golden-hour", "sandscape-sable-en-mouvement", "tapis-de-salle-de-bain-magique"],
        ["les-pantoufles", "les-chaussettes-dours", "claquettes-requins", "enceinte-virale-sans-fil", "mini-aspirateur-de-voiture"],
    ),
    "animaux": (["le-jouet-viral-pour-chat"], ["rouleau-anti-poils"]),
    "sport": (["2-in-1-smartwatch-earpods-copy"], []),
}

# FR handle -> handle in products-en.csv, for the niches whose 20 products all exist in English.
EN_HANDLE = {
    "dispositif-hydrafacial-portable-copy": "at-home-hydrafacial-device",
    "appareil-de-soin-tonifiant-visage": "microcurrent-toning-device",
    "eliminateur-de-points-noirs-a-ultrasons": "ultrasonic-face-scrubber",
    "le-boucleur-5-en-1": "5-in-1-hair-styler",
    "boucleur-automatique-sans-fil": "automatic-cordless-hair-curler",
    "rape-a-pied-electrique": "electric-callus-remover",
    "le-lisseur-a-barbe": "beard-straightener",
    "fibres-capillaires": "hair-fibers",
    "rouleau-anti-cellulites": "cellulite-massager",
    "stylo-anti-acne-a-lumiere-bleue": "acne-pen",
    "stick-pour-les-yeux-au-retinol": "retinol-eye-stick",
    "le-cube-de-glace-magique": "face-ice-roller",
    "recourbe-cils-chauffant": "heated-lash-curler",
    "taille-sourcils-electrique": "eyebrow-trimmer",
    "le-stylo-magique-4-en-1-copy": "4-in-1-makeup-pen",
    "kit-de-frisage-sans-chaleur": "heatless-hair-curler-kit",
    "brosse-demelante": "detangling-brush",
    "kit-de-demarrage-blinger®-180-pierres": "blinger®-starter-kit-180-gems",
    "nettoyeur-magique-de-pinceaux": "automatic-makeup-brush-cleaner",
    "le-rasoir-4-en-1": "4-in-1-shaver",
}

ACRONYMS = {"TENS", "USB", "LED", "EMS", "UV", "XXL", "4D", "3D", "PU", "ABS"}


def read_csv(path):
    raw = open(path, encoding="utf-8-sig", newline="").read()
    rows = list(csv.reader(io.StringIO(raw), delimiter=";"))
    return rows[0], rows[1:]


def write_csv(path, head, rows):
    out = io.StringIO()
    csv.writer(out, delimiter=";").writerows([head] + rows)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out.getvalue())


def sentence(title):
    """'IL VOUS PARLE (VRAIMENT)' -> 'Il vous parle (vraiment)', keeping acronyms such as USB."""
    words = [w if w.strip("(),.!") in ACRONYMS else w.lower() for w in title.split()]
    s = " ".join(words)
    return s[:1].upper() + s[1:]


def price(text):
    return float(text.replace(",", "."))


def money(x):
    return f"{x:.2f}"


PHOTO_SIZE = 1000


def sips(*args):
    subprocess.run(["sips", *map(str, args)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def size_of(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)], capture_output=True, text=True).stdout
    vals = [int(l.split(":")[1]) for l in out.splitlines() if "pixel" in l]
    return vals[0], vals[1]


def make_photo(handle, spec, out):
    """Square JPEG of a supplier photo: optional square crop, white padding, PHOTO_SIZE px."""
    name, crop = (spec, None) if isinstance(spec, str) else (spec[0], spec[1:])
    src = sorted(glob.glob(str(HERE / "raw" / handle / f"{name}.*")))[0]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "w.png"
        sips("-s", "format", "png", src, "--out", work)
        w, h = size_of(work)
        if crop:
            x, y, size = crop
            side = int(min(size * w, size * h, w - x * w, h - y * h))
            # sips ignores the whole crop when an offset is 0, hence max(1, …)
            sips("-c", side, side, "--cropOffset", max(1, int(y * h)), max(1, int(x * w)), work)
            w = h = side
        if w != h:
            sips("-p", max(w, h), max(w, h), "--padColor", "FFFFFF", work)
        sips("-Z", PHOTO_SIZE, work)
        sips("-s", "format", "jpeg", "-s", "formatOptions", "85", work, "--out", out)


def product_images(h):
    """Picked supplier photos first, then the description visuals not already among them."""
    folder = PUBLIC / "media/images"
    urls = []
    for n, spec in enumerate(PHOTOS[h], 1):
        out = folder / f"{h}-photo-{n}.jpg"
        if not out.exists():
            make_photo(h, spec, out)
        urls.append(f"{MEDIA}/{out.name}")
    picked_whole = {s for s in PHOTOS[h] if isinstance(s, str)}
    for n in (1, 2):
        from_gallery = h not in GOOGLE_VISUALS and f"g{VISUALS[h][n - 1]}" in picked_whole
        if not from_gallery:
            urls.append(f"{MEDIA}/{h}-visuel-{n}.jpg")
    return urls


def new_rows(p, head, template, summary, reviews, sheet, tags):
    h = p["handle"]
    sale = price(sheet[h]["Prix de vente conseillé (€)"])
    images = product_images(h)
    body = next(r for r in DESCRIPTIONS if r[2] == h)[4]
    main = dict(template)
    main.update({
        "Handle": h, "Title": p["title"], "Body (HTML)": body, "Vendor": "OneScale",
        "Product Category": "", "Type": "", "Tags": tags, "Published": "True",
        "Option1 Name": "Title", "Option1 Value": "Default Title",
        "Variant Price": money(sale), "Variant Compare At Price": money(sale * 2 + 0.01),
        "Image Src": images[0], "Image Position": "1", "Image Alt Text": p["title"],
        "Variant Image": images[0],
        "Checkbox 1 (product.metafields.custom.checkbox_1)": sentence(p["icons"][0][0]),
        "Checkbox 2 (product.metafields.custom.checkbox_2)": sentence(p["icons"][1][0]),
        "Checkbox 3 (product.metafields.custom.checkbox_3)": sentence(p["icons"][2][0]),
        SUMMARY: json.dumps(summary[h], ensure_ascii=False, separators=(",", ":")) if h in summary else "",
        REVIEWS: json.dumps(reviews[h], ensure_ascii=False, separators=(",", ":")) if h in reviews else "",
    })
    rows = [[main.get(c, "") for c in head]]
    for i, src in enumerate(images[1:], 2):
        extra = {"Handle": h, "Image Src": src, "Image Position": str(i), "Image Alt Text": p["title"]}
        rows.append([extra.get(c, "") for c in head])
    return rows


def retag(rows, head, tags):
    hi, ti, gi = head.index("Handle"), head.index("Title"), head.index("Tags")
    out = []
    for r in rows:
        r = r + [""] * (len(head) - len(r))
        if r[ti]:
            r[gi] = tags
        out.append(r)
    return out


def group(rows, head):
    hi = head.index("Handle")
    g = {}
    for r in rows:
        g.setdefault(r[hi], []).append(r)
    return g


def tags_for(niche, lang, core):
    t = [NICHE_TAG[niche][lang], lang.upper()]
    return ", ".join(t + [CORE_TAG] if core else t)


def main():
    global DESCRIPTIONS
    _, DESCRIPTIONS = read_csv(HERE / "descriptions-nouveaux-produits.csv")
    sheet = {r["Handle"]: r for r in csv.DictReader(open(HERE / "produits-niches-aliexpress.csv", encoding="utf-8-sig"), delimiter=";")}
    summary = json.load(open(HERE / "avis-acheteurs.json", encoding="utf-8"))["fr"]
    reviews = json.load(open(HERE / "avis-extraits.json", encoding="utf-8"))["fr"]

    head, rows = read_csv(PUBLIC / "products.csv")
    old = group(rows, head)
    template = dict(zip(head, old["masseur-cervical"][0]))  # single-product defaults (inventory, shipping, tax…)
    head_en, rows_en = read_csv(PUBLIC / "products-en.csv")
    old_en = group(rows_en, head_en)

    for niche, (core_old, upsell_old) in EXISTING.items():
        new = [p for p in P if DATA_NICHE.get(p["niche"]) == niche]
        core = [("old", h) for h in core_old] + [("new", p) for p in new if p["role"] == "Principal"]
        upsell = [("old", h) for h in upsell_old] + [("new", p) for p in new if p["role"] == "Upsell"]
        assert (len(core), len(upsell)) == (10, 10), (niche, len(core), len(upsell))

        out = []
        for is_core, items in ((True, core), (False, upsell)):
            tags = tags_for(niche, "fr", is_core)
            for kind, x in items:
                if kind == "old":
                    out += retag(old[x], head, tags)
                else:
                    out += new_rows(x, head, template, summary, reviews, sheet, tags)
        write_csv(PUBLIC / f"products-{niche}.csv", head, out)
        print(f"products-{niche}.csv: {len(core) + len(upsell)} products, {len(out)} rows")

        # English: only when every product of the niche exists in products-en.csv.
        if all(kind == "old" and x in EN_HANDLE for kind, x in core + upsell):
            out = []
            for is_core, items in ((True, core), (False, upsell)):
                for _, x in items:
                    out += retag(old_en[EN_HANDLE[x]], head_en, tags_for(niche, "en", is_core))
            write_csv(PUBLIC / f"products-{niche}-en.csv", head_en, out)
            print(f"products-{niche}-en.csv: 20 products, {len(out)} rows")


if __name__ == "__main__":
    main()
