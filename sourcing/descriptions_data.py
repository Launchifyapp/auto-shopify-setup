# Copy + mini market study for the 60 new products.
# Structure of each description (same as the existing Launchify catalog):
#   hook title, video, 4 icon blocks (title + text), then 2 visuals each followed by a heading and a paragraph.
# The study is based on AliExpress buyer reviews (rating, count, recurring praise and complaints)
# plus market context; it is not shown on the store.

P = []

NICHES = {
    "Animaux": {
        "contexte": "Environ 16,6 millions de chats et 9,9 millions de chiens en France (estimations FACCO / I-CAD 2024). "
                    "53 % des Français ont un chien et/ou un chat (baromètre FACCO / Odoxa 2025). Les achats sont très émotionnels : "
                    "le maître veut un animal heureux, calme et en sécurité, et adore partager ses moments mignons sur les réseaux.",
        "leviers": "Émotion et complicité, culpabilité de laisser l'animal seul ou de le voir stressé, praticité au quotidien (poils, eau, voiture), "
                   "effet « trop mignon » partageable.",
    },
    "Bien-être": {
        "contexte": "43 % des Français déclarent au moins un trouble du sommeil (INSV, enquête de décembre 2024). Écrans, télétravail et stress "
                    "créent une forte demande de solutions de détente à la maison, sans rendez-vous.",
        "leviers": "Soulagement rapide, rituel du soir, alternative au téléphone, auto-soin abordable, idée cadeau. "
                   "Contrainte : aucune allégation médicale, uniquement du bien-être.",
    },
    "Maison": {
        "contexte": "Le cocooning et la déco d'ambiance (lumières, végétal, objets malins) se vendent sur l'effet « waouh » visuel et l'envie "
                    "de transformer son intérieur à petit prix. Beaucoup d'achats sont des cadeaux.",
        "leviers": "Ambiance et esthétique, gadget malin qui simplifie la vie, plaisir de montrer l'objet à ses invités, cadeau original.",
    },
    "Sport": {
        "contexte": "Le sport à la maison s'est installé durablement : petits accessoires peu encombrants, séances courtes, tendances Pilates "
                    "et TikTok fitness. L'acheteur veut des résultats sans abonnement ni matériel lourd.",
        "leviers": "Progrès visibles, gain de temps, plaisir et défi, tendance (Pilates, gainage), prix d'un seul cours pour un accessoire durable.",
    },
}

SOURCES = [
    ("FACCO / Odoxa 2025 et estimations FACCO / I-CAD 2024", "https://www.facco.fr/wp-content/uploads/2025/06/2025-06-facco-chiffres-odoxa.pdf"),
    ("INSV, Journée du sommeil 2025 (enquête de décembre 2024)", "https://institut-sommeil-vigilance.org/wp-content/uploads/2020/02/Communique-de-Presse-INSV-JS-2025.pdf"),
    ("Université d'Helsinki, anxiété chez ~14 000 chiens (relayé par Paris Match)", "https://www.parismatch.be/actualites/environnement/2020/03/12/selon-une-etude-une-majorite-de-chiens-souffrent-danxiete-et-nous-ne-serions-pas-assez-attentifs-E4WBEW7LFZCZ7EC7XG24OZWK2I/"),
]


def add(niche, role, handle, title, study, hook, icons, s1, s2):
    assert len(icons) == 4, handle
    for k in ("note", "cible", "probleme", "declic", "adorent", "objection", "angle"):
        assert study.get(k), (handle, k)
    P.append(dict(niche=niche, role=role, handle=handle, title=title, study=study,
                  hook=hook, icons=icons, s1=s1, s2=s2))


from data_animaux import load as _a  # noqa: E402
from data_bienetre import load as _b  # noqa: E402
from data_maison import load as _m  # noqa: E402
from data_sport import load as _s  # noqa: E402
from data_remplacements import load as _r, REPLACES  # noqa: E402

# Replacement products are written once, then dropped into the slot of the product they replace.
_replacements = {}


def _collect(niche, role, handle, title, study, hook, icons, s1, s2):
    _replacements[handle] = (niche, role, handle, title, study, hook, icons, s1, s2)


_r(_collect)


class _Adder:
    def __call__(self, *args):
        add(*args)

    def slot(self, old_handle):
        new = _replacements[REPLACES[old_handle]]
        add(*new)
        P[-1]["replaces"] = old_handle


for _load in (_a, _b, _m, _s):
    _load(_Adder())

assert len(P) == 60, len(P)
assert len({p["handle"] for p in P}) == 60
