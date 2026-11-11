"""Public review excerpts shown under the buyer summary on product pages.

Sources (raw copies in sourcing/avis-bruts/, fetched 2026-11-11):
  - Amazon.fr: the French reviews shown on the product page of the equivalent
    model (same ASINs as the summary in avis_acheteurs.py), at most ~8 each.
  - AliExpress: the reviews of the exact listing linked in produits-niches-aliexpress.csv,
    in AliExpress's default order, French translation when AliExpress provides one.

Rules: no reviewer names, reviews mentioning health left out (HEALTH), no rating-based filtering (we keep the site's display order),
at most MAX reviews per product, long texts cut with "…", emojis removed, exact
duplicates dropped (AliExpress repeats some texts across variants). Output goes to
the product metafield launchify.buyer_reviews (json):
  {"site", "basis", "items": [{"r": stars, "t": title, "x": text, "d": date, "tr": machine-translated}]}
"""
import csv, glob, io, json, os, re, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "sourcing/avis-bruts"
COL = "Avis publics (product.metafields.launchify.buyer_reviews)"
MAX = 30
MIN = 3  # below this (e.g. after the health filter) the list would not be representative: show none
CUT = 320
CSV_HANDLE = {"kit-de-demarrage-blinger": "kit-de-demarrage-blinger®-180-pierres"}

# Reviews that talk about health (pain, migraine, sleep disorders, skin conditions…) are left out:
# shown on our product page they would read as health claims made by the store.
HEALTH = re.compile(r"\b(douleurs?|douloureu\w*|migraines?|céphalées?|fasciite|arthrose|arthrite|sciatique|tendinite|insomnies?|guéri\w*|soign\w*|soulag\w*|médec\w*|médica\w*|thérap\w*|kiné\w*|anxiété|dépression|cellulite|acné|ride[s]?|ridules|cicatri\w*|maladie|symptômes?|traitement|circulation|inflamm\w*|hernie|scoliose|apnée|ronfle\w*|(?:pas|plus) mal (?:au|aux|à|de|du))\b", re.I)
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍←-⇿]")


def clean(t):
    t = EMOJI.sub("", t or "")
    t = re.sub(r"\s*\n+\s*", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"([a-zà-ÿ)][.!?…])([A-ZÀ-Ý])", r"\1 \2", t)  # paragraphs glued together by the source page
    t = re.sub(r"(?<=[a-zà-ÿ]{3})([A-ZÀ-Ý])(?=[a-zà-ÿ' ])", r" \1", t)  # "produitIl tient" -> "produit Il tient"
    return re.sub(r"\s+([,.])", r"\1", t)


def cut(t, n=CUT):
    if len(t) <= n:
        return t
    c = t[:n]
    p = max(c.rfind(". "), c.rfind("! "), c.rfind("? "))
    if p > n * 0.55:
        return c[: p + 1] + " …"
    return c[: c.rfind(" ")].rstrip(",;:") + "…"


def is_english(t):
    low = t.lower()
    en = len(re.findall(r"\b(the|and|it|is|very|this|with|my|i|love|great|was)\b", low))
    fr = len(re.findall(r"\b(le|la|les|et|est|très|pour|je|un|une|des|pas|il|elle)\b", low))
    return en > fr


def amazon():
    data = json.load(open(RAW / "amazon-fr.json", encoding="utf-8"))
    out = {}
    for h, revs in data.items():
        items = []
        for r in revs:
            x = clean(r["text"])
            if len(x) < 30 or is_english(x) or HEALTH.search(x + " " + r["title"]):
                continue
            item = {"r": r["stars"], "t": clean(r["title"]), "x": cut(x), "d": r["date"].replace("Avis laissé en France le ", ""), "tr": False}
            items.append({k: v for k, v in item.items() if v != ""})
        if len(items) >= MIN:
            out[CSV_HANDLE.get(h, h)] = {"site": "Amazon.fr", "basis": "modèle équivalent", "items": items[:MAX]}
    return out


def aliexpress():
    out = {}
    for f in sorted(glob.glob(str(RAW / "aliexpress/*.json"))):
        h = Path(f).stem
        raw = json.load(open(f, encoding="utf-8"))
        revs = raw["reviews"]
        text = lambda e: clean(e.get("tr") or e.get("x"))
        seen = collections.Counter(text(e) for e in revs)
        items = []
        for e in revs:
            x = text(e)
            if len(x) < 25 or seen[x] > 1 or not re.search(r"[a-zàâçéèêëîïôûùüÿœ]", x) or HEALTH.search(x):
                continue
            items.append({"r": e["r"], "x": cut(x), "d": e["d"], "tr": bool(e.get("tr")) and clean(e["x"]) != x})
            if len(items) == MAX:
                break
        if len(items) >= MIN:
            # AliExpress pools reviews of "similar items from different sellers" on some listings.
            basis = "modèle équivalent" if raw.get("pooled") else "même modèle"
            out[h] = {"site": "AliExpress", "basis": basis, "items": items}
    return out


def add_column(path, data):
    raw = open(path, encoding="utf-8-sig", newline="").read()
    rows = list(csv.reader(io.StringIO(raw), delimiter=";"))
    head = rows[0]
    if COL not in head:
        head.append(COL)
        for r in rows[1:]:
            r.append("")
    i, hi, ti = head.index(COL), head.index("Handle"), head.index("Title")
    n = 0
    for r in rows[1:]:
        r += [""] * (len(head) - len(r))
        first = bool(r[ti])
        r[i] = json.dumps(data[r[hi]], ensure_ascii=False, separators=(",", ":")) if first and r[hi] in data else ""
        n += bool(r[i])
    out = io.StringIO()
    csv.writer(out, delimiter=";").writerows(rows)
    text = out.getvalue()
    if not raw.endswith("\n"):
        text = text[:-2]
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print(f"{path.name}: {n} products with public reviews")


if __name__ == "__main__":
    fr = {**amazon(), **aliexpress()}
    (ROOT / "sourcing/avis-extraits.json").write_text(json.dumps({"fr": fr}, ensure_ascii=False, indent=1))
    n = collections.Counter(len(v["items"]) for v in fr.values())
    print(f"FR {len(fr)} products, {sum(k * v for k, v in n.items())} reviews")
    for name in ("products.csv", "products-20.csv"):
        add_column(ROOT / "public" / name, fr)
