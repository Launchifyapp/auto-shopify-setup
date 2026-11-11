"""Product photos (the product gallery on the store) for the 60 new products, picked by eye.

Each entry is a supplier photo from raw/<handle>/: g<n> = AliExpress listing gallery, s<n> = variant
(SKU) photo from sku_images.json (variant photos of 30 listings, collected on 2026-11-11). Photos with overlay text (English/Chinese selling points, health
claims, other sellers' logos) were left out, or cropped to the product with (photo, x, y, size): a
square crop, in fractions of the image width/height, from the top-left corner (x, y).

The first photo is the main product image. The two description visuals are added after these
(see build_niche_csvs.py), unless one of them is already in the list.
"""

PHOTOS = {
    # Animaux
    "boutons-parlants-chien": ["g1", "g5", "g2"],
    "etageres-murales-escalade-chat": ["g1", "g4", "g6", "g5"],
    "siege-auto-console-chien": ["g2", "g1", "g3", "g4"],
    "tente-pliable-chat": ["s1", ("g4", 0.05, 0.15, 0.85), "g3"],
    "sac-de-couchage-chat": ["g3", "g1", "g5", "g2"],
    "hamac-fenetre-echelle-chat": ["g3", "g2", "g5"],
    "gilet-sauvetage-requin-chien": ["g6", "g2", "g3"],
    "pulverisateur-douche-chien": ["g2", "g1", "g6", "g4"],
    "brosse-vapeur-chien": ["g1", ("g3", 0.12, 0.15, 0.85)],
    "collier-laser-chat": ["s1", "s2"],
    "casque-anti-bruit-chien": ["g2", "g1", "g6"],
    "gamelle-anti-eclaboussures": ["g5", "g2", "g3", "g4"],
    "couverture-auto-chauffante": [("g2", 0.10, 0.15, 0.85), ("g5", 0.30, 0.35, 0.65)],
    "jouet-porte-oiseau-chat": ["g1", ("g5", 0.08, 0.12, 0.76)],
    "collier-lumineux-led-chien": [("g1", 0.05, 0.08, 0.92), ("s5", 0.25, 0.05, 0.72)],
    "gant-anti-poils": ["g6", "g5", "g4"],
    "tapis-fouille-escargot": ["g3", "g1", "g2", "g4"],
    "gobelet-pliable-feuille": ["s1", "s2", "g6"],
    # Bien-être
    "appareil-aide-sommeil": ["g6", ("s4", 0.15, 0.30, 0.70)],
    "sangle-etirement-cou": ["g1", "s1"],
    "masseur-chevilles-chauffant": ["s1", "s2", ("g1", 0.30, 0.35, 0.65), ("g4", 0.30, 0.0, 0.55)],
    "masseur-tens-nuque": [("g1", 0.0, 0.08, 0.92), ("s2", 0.10, 0.25, 0.75)],
    "porte-cles-anti-stress-touches": ["g1", "g4", "g2"],
    "pinces-acupression-mains": ["g2", "g6", "g4"],
    "anneaux-massage-su-jok": ["g1", "g2", "g3"],
    "entraineur-respiratoire": ["s1", "s2", "g2"],
    "lunettes-ambrees-soir": ["g6", "g3", "g5", "g4"],
    "rouleau-glace-visage": ["g1", "g3", "g2"],
    "bouchons-oreilles-silicone": [("g4", 0.15, 0.25, 0.75), ("g3", 0.02, 0.12, 0.42)],
    "tapis-ems-pieds": [("g1", 0.0, 0.40, 0.60), ("s2", 0.05, 0.18, 0.80), ("g3", 0.05, 0.30, 0.70)],
    # Maison
    "projecteur-ondulations-eau": ["g3", "g2", "g4", "g1"],
    "reveil-projecteur-plafond": ["g1", "s3", "s2", ("g5", 0.20, 0.0, 0.60)],
    "tableau-led-acrylique": ["g1", "g6", "g4"],
    "lampe-bouteille-vin": ["g1", "g2", "g3", "g4"],
    "humidificateur-effet-flamme": [("g1", 0.0, 0.12, 0.78), ("g3", 0.15, 0.15, 0.65), "s1"],
    "terrarium-mural-hydroponique": ["g1", "g2", "g4", "g5"],
    "rallonge-robinet-360": ["g3", ("g6", 0.0, 0.0, 0.80)],
    "mini-lampe-murale-rechargeable": ["s1", "s2", "g6", ("g4", 0.15, 0.0, 0.62)],
    "pot-auto-arrosant": ["g2", "g4", "g3"],
    "vase-ampoule-hydroponique": ["g2", "g1", "g3", "g4"],
    "tapis-robinet-silicone": ["g1", "g2", "g3"],
    # Sport
    "barre-flexible-avant-bras": [("g1", 0.05, 0.08, 0.92)],
    "planche-etirement-mollets": ["g6", ("g5", 0.0, 0.12, 0.88), ("g1", 0.05, 0.08, 0.92)],
    "rouleau-poignet-reglable": ["g1", "s1", "s2", ("g4", 0.05, 0.30, 0.70)],
    "entraineur-plancher-pelvien": ["g1", "s1", ("g4", 0.05, 0.25, 0.75)],
    "barre-pilates-portable": ["g1", "s3", "s2", ("g5", 0.15, 0.08, 0.62)],
    "planche-pompes-multifonction": ["g1", ("g6", 0.15, 0.30, 0.55)],
    "briques-squat-inclinees": ["s1", "s2", ("g1", 0.08, 0.17, 0.83)],
    "ceinture-ems-abdos": ["g1", "s1"],
    "hula-hoop-leste": [("s4", 0.18, 0.17, 0.63), ("g6", 0.0, 0.12, 0.80), ("g4", 0.30, 0.30, 0.70)],
    "balle-reflexe-boxe": ["g1", "s3", "s1"],
    "disques-glisse": [("g1", 0.05, 0.08, 0.92), ("g3", 0.0, 0.30, 0.60)],
    "chaussettes-pilates": ["g2", "g3", "g4", "g5"],
    "corde-sauter-sans-fil": [("g1", 0.05, 0.08, 0.92), "g5"],
    "hand-grip-compteur": ["g1", "g2"],
    "anneau-pilates": ["g1", "g6", "g3"],
    "tendeur-pedale": ["g1", "g6"],
    "sangles-poignet": ["g1", "g6"],
    "balle-massage-cacahuete": ["g1", "g2", "g3"],
    "genouillere-silicone": [("g6", 0.05, 0.10, 0.90), ("s1", 0.05, 0.10, 0.85), ("g4", 0.05, 0.30, 0.70)],
}
