# Description visuals picked by eye from Google Images candidates (raw-google/<handle>/c<n>.*, see google_candidates.json).
# Criteria (from the 40 existing products): square-ish, sharp, no text or logo, shows the product in use or a key feature.

PICKS = {
    "anneaux-massage-su-jok": (1, 12), "sangle-etirement-cou": (2, 10), "gamelle-anti-eclaboussures": (1, 6),
    "gilet-sauvetage-requin-chien": (8, 14), "ceinture-ems-abdos": (3, 13), "barre-pilates-portable": (8, 12),
    "tapis-ems-pieds": (7, 6), "balle-reflexe-boxe": (7, 1), "hamac-fenetre-echelle-chat": (3, 4),
    "rallonge-robinet-360": (13, 6), "masseur-tens-nuque": (10, 11), "gant-anti-poils": (1, 12),
    "chaussettes-pilates": (2, 5), "boutons-parlants-chien": (10, 11), "balle-massage-cacahuete": (7, 9),
    "disques-glisse": (1, 9), "sac-de-couchage-chat": (6, 8), "porte-cles-anti-stress-touches": (5, 4),
    "humidificateur-effet-flamme": (4, 9), "couverture-auto-chauffante": (7, 6), "tapis-robinet-silicone": (4, 12),
    "anneau-pilates": (8, 3), "pulverisateur-douche-chien": (4, 9), "projecteur-ondulations-eau": (5, 10),
    "casque-anti-bruit-chien": (6, 10), "lunettes-ambrees-soir": (8, 5), "masseur-chevilles-chauffant": (13, 8),
    "pinces-acupression-mains": (2, 10), "jouet-porte-oiseau-chat": (2, 6), "collier-laser-chat": (3, 6),
    "siege-auto-console-chien": (1, 4), "genouillere-silicone": (8, 5), "planche-etirement-mollets": (2, 5),
    "tendeur-pedale": (8, 9), "corde-sauter-sans-fil": (2, 7),
    "entraineur-plancher-pelvien": (2, 5), "mini-lampe-murale-rechargeable": (1, 9), "appareil-aide-sommeil": (5, 1),
    "pot-auto-arrosant": (2, 6), "bouchons-oreilles-silicone": (10, 12), "hula-hoop-leste": (1, 9),
    "rouleau-poignet-reglable": (1, 7), "entraineur-respiratoire": (10, 11), "vase-ampoule-hydroponique": (2, 3),
    "hand-grip-compteur": (7, 4), "sangles-poignet": (7, 2), "terrarium-mural-hydroponique": (7, 3),
    "lampe-bouteille-vin": (3, 9), "briques-squat-inclinees": (9, 8), "etageres-murales-escalade-chat": (5, 7),
    "planche-pompes-multifonction": (11, 4), "reveil-projecteur-plafond": (4, 5), "brosse-vapeur-chien": (6, 10),
    "tableau-led-acrylique": (9, 8), "collier-lumineux-led-chien": (4, 5), "tapis-fouille-escargot": (1, 9),
    "tente-pliable-chat": (2, 3), "rouleau-glace-visage": (6, 3),
}

# Products to review by hand: no satisfying text-free image found, or images that may show another model.
FLAGS = {
    "gobelet-pliable-feuille": "Aucune image du gobelet en forme de feuille sur Google (résultats = gourdes classiques) : visuels AliExpress conservés.",
    "boutons-parlants-chien": "Les photos d'usage (chien qui appuie) ont toutes du texte : seuls des boutons seuls retenus.",
    "gant-anti-poils": "Pas de photo d'usage sans texte : gants seuls retenus.",
    "bouchons-oreilles-silicone": "Pas de photo portée sans texte : bouchons seuls retenus.",
    "entraineur-respiratoire": "Pas de photo d'usage sans texte : produit seul retenu.",
    "appareil-aide-sommeil": "Photos du produit seul, sans mise en situation.",
    "barre-flexible-avant-bras": "Les images Google montrent presque toutes la marque TheraBand : visuels AliExpress conservés (avec texte).",
}

# Chosen images that show a close but different model from the supplier product: check before going live.
MODEL_CHECK = {
    "gamelle-anti-eclaboussures", "pulverisateur-douche-chien", "casque-anti-bruit-chien", "sangle-etirement-cou",
    "masseur-tens-nuque", "ceinture-ems-abdos", "briques-squat-inclinees", "humidificateur-effet-flamme",
    "mini-lampe-murale-rechargeable", "planche-pompes-multifonction", "tableau-led-acrylique", "vase-ampoule-hydroponique",
}
