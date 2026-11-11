"""Buyer-review summaries ("Ce que les acheteurs en disent") for every product.

Each entry is a synthesis written from PUBLIC reviews on Amazon.fr / AliExpress
for the same or an equivalent model. Nothing here is presented as a review of
our store: the theme block says so explicitly. Ratings and counts are the ones
observed on the source sites (Nov. 2026).

Output: sourcing/avis-acheteurs.json  -> {"fr": {handle: data}, "en": {handle: data}}
and a column "Avis acheteurs (product.metafields.launchify.buyer_summary)" in the
public/products*.csv files (FR for products*.csv, EN for products*-en.csv).

Run:  python3 sourcing/avis_acheteurs.py
"""
import csv, io, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COL = "Avis acheteurs (product.metafields.launchify.buyer_summary)"

# ---------------------------------------------------------------------------
# 40 existing products: Amazon.fr equivalent model (rating, count)
# ---------------------------------------------------------------------------
AMZ = {
    "appareil-de-soin-tonifiant-visage": (4.0, 2474),
    "boucleur-automatique-sans-fil": (4.6, 18479),
    "brosse-demelante": (4.4, 52135),
    "claquettes-requins": (4.2, 1898),
    "diffuseur-volcanique": (4.5, 1502),
    "dispositif-hydrafacial-portable-copy": (4.4, 144),
    "enceinte-virale-sans-fil": (4.3, 4246),
    "eliminateur-de-points-noirs-a-ultrasons": (4.1, 12508),
    "fibres-capillaires": (4.0, 54999),
    "kit-de-demarrage-blinger®-180-pierres": (4.3, 660),
    "kit-de-frisage-sans-chaleur": (3.6, 6256),
    "la-lampe-golden-hour": (3.8, 2973),
    "le-boucleur-5-en-1": (4.1, 305),
    "le-cube-de-glace-magique": (4.2, 2311),
    "le-jouet-viral-pour-chat": (4.6, 7628),
    "le-lisseur-a-barbe": (4.3, 7201),
    "le-rasoir-4-en-1": (4.2, 3116),
    "le-stylo-magique-4-en-1-copy": (3.9, 685),
    "les-chaussettes-dours": (4.6, 5249),
    "les-pantoufles": (4.3, 1416),
    "masque-de-sommeil-avec-ecouteurs-integres": (4.2, 22794),
    "masseur-oculaire-bluetooth": (4.2, 26510),
    "mini-aspirateur-de-voiture": (4.7, 319),
    "2-in-1-smartwatch-earpods-copy": (3.4, 155),
    "nettoyeur-magique-de-pinceaux": (3.1, 224),
    "plante-en-levitation": (4.0, 476),
    "rape-a-pied-electrique": (4.4, 34329),
    "recourbe-cils-chauffant": (4.2, 102),
    "rouleau-anti-poils": (4.3, 103484),
    "rouleau-anti-cellulites": (4.2, 1156),
    "sandscape-sable-en-mouvement": (4.0, 1380),
    "semelles-4d": (4.5, 2163),
    "semelles-chauffantes": (4.2, 1873),
    "stick-pour-les-yeux-au-retinol": (3.8, 241),
    "taille-sourcils-electrique": (4.5, 5551),
    "tapis-de-salle-de-bain-magique": (4.4, 6115),
    "bonnet-anti-migraine": (4.5, 13399),
    "ceinture-menstruelle": (4.4, 1884),
    # masseur-cervical, stylo-anti-acne-a-lumiere-bleue: no reliable equivalent -> no block
}

EN_HANDLE = {
    "2-in-1-smartwatch-earpods-copy": "2-in-1-smartwatch-earpods",
    "le-stylo-magique-4-en-1-copy": "4-in-1-makeup-pen",
    "le-rasoir-4-en-1": "4-in-1-shaver",
    "semelles-4d": "4d-insoles",
    "le-boucleur-5-en-1": "5-in-1-hair-styler",
    "tapis-de-salle-de-bain-magique": "absorbent-bathroom-mat",
    "diffuseur-volcanique": "aromatherapy-humidifier",
    "dispositif-hydrafacial-portable-copy": "at-home-hydrafacial-device",
    "boucleur-automatique-sans-fil": "automatic-cordless-hair-curler",
    "nettoyeur-magique-de-pinceaux": "automatic-makeup-brush-cleaner",
    "les-chaussettes-dours": "bear-socks",
    "le-lisseur-a-barbe": "beard-straightener",
    "kit-de-demarrage-blinger®-180-pierres": "blinger®-starter-kit-180-gems",
    "rouleau-anti-cellulites": "cellulite-massager",
    "les-pantoufles": "cloud-slipper",
    "brosse-demelante": "detangling-brush",
    "rape-a-pied-electrique": "electric-callus-remover",
    "masseur-oculaire-bluetooth": "eye-massager",
    "taille-sourcils-electrique": "eyebrow-trimmer",
    "le-cube-de-glace-magique": "face-ice-roller",
    "la-lampe-golden-hour": "golden-hour-lamp",
    "fibres-capillaires": "hair-fibers",
    "masque-de-sommeil-avec-ecouteurs-integres": "headband-sleeping-mask",
    "recourbe-cils-chauffant": "heated-lash-curler",
    "semelles-chauffantes": "heating-insoles",
    "kit-de-frisage-sans-chaleur": "heatless-hair-curler-kit",
    "plante-en-levitation": "levitating-plant",
    "ceinture-menstruelle": "menstrual-relief-belt",
    "appareil-de-soin-tonifiant-visage": "microcurrent-toning-device",
    "mini-aspirateur-de-voiture": "mini-car-vacuum-cleaner",
    "rouleau-anti-poils": "pet-fur-dust-remover",
    "stick-pour-les-yeux-au-retinol": "retinol-eye-stick",
    "sandscape-sable-en-mouvement": "sandscape-moving-sand",
    "bonnet-anti-migraine": "snooze-cap",
    "claquettes-requins": "the-sharkies",
    "le-jouet-viral-pour-chat": "the-viral-cat-toy",
    "eliminateur-de-points-noirs-a-ultrasons": "ultrasonic-face-scrubber",
    "enceinte-virale-sans-fil": "wireless-viral-speaker",
}

# handle: (FR likes, FR note, EN likes, EN note)
OLD = {
"appareil-de-soin-tonifiant-visage": (
    ["Facile à intégrer à la routine du soir", "Résultats jugés visibles avec un usage régulier", "Format compact et finitions soignées"],
    "Les avis les plus satisfaits viennent d'un usage quotidien : c'est un rituel, pas un effet instantané.",
    ["Easy to fit into an evening routine", "Results described as visible with regular use", "Compact, well-finished device"],
    "The happiest reviewers use it daily: it's a routine, not an instant fix."),
"boucleur-automatique-sans-fil": (
    ["Très simple, même pour celles qui ne se coiffent jamais", "Boucles réussies en une dizaine de minutes", "Très bon rapport qualité-prix"],
    "Moins adapté aux cheveux très courts ou très abîmés, selon quelques avis.",
    ["Very easy, even for people who never style their hair", "Nice curls in about ten minutes", "Great value for money"],
    "A few reviewers found it less suited to very short or very damaged hair."),
"brosse-demelante": (
    ["Démêle sans arracher, même sur cheveux bouclés", "S'utilise sous la douche avec l'après-shampoing", "Peu de casse constatée"],
    "Jugée un peu souple pour les cheveux très crépus par certains acheteurs.",
    ["Detangles without pulling, even on curly hair", "Works in the shower with conditioner", "Little breakage reported"],
    "Some buyers find it a little soft for very coily hair."),
"claquettes-requins": (
    ["Design requin qui fait rire petits et grands", "Confortables et résistantes", "Idée cadeau très appréciée"],
    "Elles taillent petit : prenez une taille au-dessus de votre pointure habituelle.",
    ["Shark design that makes kids and adults laugh", "Comfortable and durable", "A popular gift"],
    "They run small: order one size up from your usual size."),
"diffuseur-volcanique": (
    ["Effet flamme très joli, même de jour", "Presque silencieux", "Diffusion qui dure longtemps"],
    "L'effet « flamme » est une lumière douce et stylisée plutôt qu'une vraie flamme.",
    ["Beautiful flame effect, even in daylight", "Almost silent", "Long-lasting diffusion"],
    "The flame effect is a soft, stylised light rather than a realistic fire."),
"dispositif-hydrafacial-portable-copy": (
    ["Facile à utiliser", "Plusieurs embouts et niveaux de puissance", "Bon rapport qualité-prix"],
    "Commencez au niveau 1 et ne restez pas au même endroit : les niveaux forts peuvent rougir la peau.",
    ["Easy to use", "Several tips and suction levels", "Good value for money"],
    "Start on level 1 and keep moving: higher levels can leave temporary redness."),
"enceinte-virale-sans-fil": (
    ["Son clair, surprenant pour la taille", "Étanche, parfaite sous la douche", "Fonctionne toujours après des mois d'usage"],
    "Fixez-la sur une surface lisse et propre pour une bonne adhérence ; le son reste celui d'une petite enceinte.",
    ["Clear sound, surprising for its size", "Waterproof, perfect in the shower", "Still working after months of use"],
    "Stick it to a clean, smooth surface for best grip; the sound is that of a small speaker."),
"eliminateur-de-points-noirs-a-ultrasons": (
    ["Pratique pour un nettoyage du visage hebdomadaire", "Simple une fois la technique prise", "Complète bien une routine de soin"],
    "Demande un petit temps d'apprentissage : regardez la notice pour l'angle et la pression.",
    ["Handy for a weekly facial cleanse", "Simple once you get the technique", "A nice add-on to a skincare routine"],
    "There's a short learning curve: check the guide for angle and pressure."),
"fibres-capillaires": (
    ["Effet densité immédiat", "Rendu discret et naturel", "N'alourdit pas les cheveux"],
    "Bien choisir la teinte et appliquer sur cheveux secs ; un peu de pratique aide au début.",
    ["Instant fuller look", "Discreet, natural result", "Doesn't weigh hair down"],
    "Pick the right shade and apply to dry hair; it takes a little practice at first."),
"kit-de-demarrage-blinger®-180-pierres": (
    ["Les enfants adorent le résultat", "Les strass tiennent bien et s'enlèvent facilement", "Super idée cadeau"],
    "La prise en main demande quelques essais la première fois.",
    ["Kids love the result", "Gems hold well and come out easily", "Great gift idea"],
    "It takes a couple of tries to get the hang of it the first time."),
"kit-de-frisage-sans-chaleur": (
    ["Boucles sans chaleur, pendant la nuit", "Pratique et confortable pour dormir", "Joli rendu une fois la technique acquise"],
    "La note est plus basse car les cheveux peuvent glisser : enroulez des mèches fines, sur cheveux légèrement humides.",
    ["Heat-free curls overnight", "Comfortable to sleep in", "Nice result once you have the technique"],
    "Ratings are lower because hair can slip: wrap thin sections on slightly damp hair."),
"la-lampe-golden-hour": (
    ["Lumière douce et réglable", "Nombreuses couleurs", "Compacte et légère"],
    "Certaines couleurs (le rouge) tirent sur l'orangé ; prévoir un adaptateur USB si besoin.",
    ["Soft, adjustable light", "Lots of colours", "Compact and light"],
    "Some colours (red) look more orange; you may need a USB plug adapter."),
"le-boucleur-5-en-1": (
    ["Sèche et met en forme en un seul outil", "Très efficace pour le brushing", "Belle finition, idée cadeau"],
    "La fonction boucles demande de l'entraînement, et l'appareil est assez bruyant.",
    ["Dries and styles in one tool", "Very effective for blow-outs", "Nice finish, good gift"],
    "The curling function takes practice, and it's fairly loud."),
"le-cube-de-glace-magique": (
    ["Sensation de fraîcheur agréable le matin", "Pratique à garder au congélateur", "Facile à remplir et à nettoyer"],
    "Suivez les instructions de remplissage la première fois.",
    ["Pleasant cooling feel in the morning", "Handy to keep in the freezer", "Easy to fill and clean"],
    "Follow the filling instructions the first time."),
"le-jouet-viral-pour-chat": (
    ["Occupe les chats pendant des heures", "Même les chats peu joueurs s'y mettent", "Relativement solide"],
    "Certains chats mettent quelques jours avant de l'adopter.",
    ["Keeps cats busy for hours", "Even lazy cats join in", "Fairly sturdy"],
    "Some cats need a few days before they take to it."),
"le-lisseur-a-barbe": (
    ["Chauffe très vite", "Discipline les barbes rebelles", "Fonctionne aussi sur les cheveux"],
    "Plus efficace sur les barbes moyennes à longues que sur les barbes courtes.",
    ["Heats up very fast", "Tames unruly beards", "Works on hair too"],
    "Works best on medium to long beards rather than short ones."),
"le-rasoir-4-en-1": (
    ["Rasage sans douleur ni irritation", "Précis pour le visage et les zones sensibles", "Bon rapport qualité-prix"],
    "Appliquez une crème hydratante après usage si votre peau a tendance à tirer.",
    ["Painless, irritation-free shave", "Precise for face and sensitive areas", "Good value for money"],
    "Use a moisturiser afterwards if your skin tends to feel dry."),
"le-stylo-magique-4-en-1-copy": (
    ["4 produits en un, idéal dans le sac", "Pigmentation appréciée", "Pratique pour les retouches"],
    "Tracé moins précis qu'un crayon dédié ; une petite prise en main est nécessaire.",
    ["4 products in one, perfect for your bag", "Good colour payoff", "Handy for touch-ups"],
    "Less precise than a dedicated pencil; it takes a little practice."),
"les-chaussettes-dours": (
    ["Très douces et chaudes", "Jolies couleurs", "Tiennent dans le temps"],
    "Taille unique assez large : elles conviennent mieux aux pointures moyennes à grandes.",
    ["Very soft and warm", "Lovely colours", "Hold up over time"],
    "One size runs fairly large: best for medium to large feet."),
"les-pantoufles": (
    ["Effet « nuage » très confortable", "Faciles à vivre, maison et piscine", "Se lavent facilement"],
    "Elles taillent petit : prenez une taille au-dessus.",
    ["Very comfortable cloud-like feel", "Easy to wear at home or by the pool", "Easy to wash"],
    "They run small: order one size up."),
"masque-de-sommeil-avec-ecouteurs-integres": (
    ["Très confortable, on l'oublie en dormant", "Occultation efficace", "Son de bonne qualité en Bluetooth"],
    "Les écouteurs sont plats et intégrés : le son reste celui d'un bandeau, pas d'un casque.",
    ["Very comfortable, you forget you're wearing it", "Blocks light well", "Good Bluetooth sound"],
    "The speakers are flat and built in: sound is headband-level, not headphone-level."),
"masseur-oculaire-bluetooth": (
    ["Chaleur et pression très relaxantes", "Musique intégrée appréciée", "Moment de détente le soir"],
    "Ajustement variable selon la forme du visage ; les boutons demandent un temps d'habitude.",
    ["Very relaxing heat and pressure", "Built-in music is a plus", "A nice wind-down ritual"],
    "Fit varies with face shape, and the buttons take some getting used to."),
"mini-aspirateur-de-voiture": (
    ["Puissant pour sa taille", "Très maniable, idéal pour la voiture", "Nombreux embouts fournis"],
    "Conçu pour les petits nettoyages rapides, pas pour remplacer un aspirateur de maison.",
    ["Powerful for its size", "Easy to handle, ideal for the car", "Lots of attachments"],
    "Made for quick clean-ups, not to replace a full-size vacuum."),
"2-in-1-smartwatch-earpods-copy": (
    ["Concept original : les écouteurs rangés dans la montre", "Fait son effet en cadeau", "Bonne finition"],
    "Autonomie courte si toutes les fonctions sont activées : désactivez celles dont vous n'avez pas besoin.",
    ["Clever concept: earbuds stored in the watch", "A great surprise gift", "Good finish"],
    "Battery life is short with every feature on: switch off the ones you don't need."),
"nettoyeur-magique-de-pinceaux": (
    ["Nettoie et sèche les pinceaux en quelques secondes", "Gain de temps apprécié", "Facile à utiliser"],
    "Pensé pour les petits et moyens pinceaux : les gros pinceaux se nettoient moins bien.",
    ["Cleans and dries brushes in seconds", "A real time-saver", "Easy to use"],
    "Designed for small and medium brushes; large ones don't clean as well."),
"plante-en-levitation": (
    ["Effet waouh en déco", "Cadeau original", "Beau design"],
    "Le pot est petit : choisissez une plante légère et manipulez-le avec douceur.",
    ["Instant wow effect", "Original gift", "Beautiful design"],
    "The pot is small: pick a light plant and handle it gently."),
"rape-a-pied-electrique": (
    ["Résultat comparable à un soin en institut", "Simple et rapide", "Prix abordable"],
    "Sur les callosités très épaisses, plusieurs passages sont nécessaires.",
    ["Salon-like results at home", "Quick and simple", "Affordable"],
    "Very thick calluses need several passes."),
"recourbe-cils-chauffant": (
    ["Efficace même sur cils raides", "Léger et facile à manier", "Plusieurs niveaux de chaleur"],
    "La tenue varie : un peu de mascara aide à fixer la courbure.",
    ["Works even on straight lashes", "Light and easy to handle", "Several heat levels"],
    "Hold varies: a coat of mascara helps set the curl."),
"rouleau-anti-poils": (
    ["Très efficace sur canapé, lit et rideaux", "Réutilisable, sans recharge", "Simple d'utilisation"],
    "Fonctionne mieux sur un tissu bien tendu que sur un vêtement porté.",
    ["Very effective on sofas, beds and curtains", "Reusable, no refills", "Simple to use"],
    "Works best on fabric that's pulled taut rather than on clothes you're wearing."),
"rouleau-anti-cellulites": (
    ["Robuste et bien conçu", "Massage palper-rouler efficace", "Rapide à utiliser"],
    "Massage tonique : commencez doucement, avec une huile, sans trop appuyer.",
    ["Sturdy and well made", "Effective roll-and-knead massage", "Quick to use"],
    "It's a firm massage: start gently, with oil, without pressing too hard."),
"sandscape-sable-en-mouvement": (
    ["Fascinant à regarder", "Joli objet de déco", "Fonctionne toujours après des mois"],
    "Le niveau d'air peut nécessiter un petit réglage à réception pour un écoulement parfait.",
    ["Mesmerising to watch", "Beautiful decor piece", "Still working after months"],
    "The air level may need a small adjustment on arrival for perfect flow."),
"semelles-4d": (
    ["Très confortables pour rester debout longtemps", "Amorti apprécié dans les chaussures de travail", "Moelleuses dès le premier jour"],
    "Ce sont des semelles de confort, pas des semelles orthopédiques sur mesure.",
    ["Very comfortable for long hours on your feet", "Great cushioning in work shoes", "Soft from day one"],
    "These are comfort insoles, not custom orthotics."),
"semelles-chauffantes": (
    ["Chauffent vraiment, même par temps froid", "Bonne autonomie à puissance moyenne", "Idéales au travail ou à vélo"],
    "Elles sont épaisses : retirez la semelle d'origine de la chaussure.",
    ["Really warm, even in cold weather", "Good battery life at medium heat", "Great for work or cycling"],
    "They're thick: remove your shoe's original insole."),
"stick-pour-les-yeux-au-retinol": (
    ["Format stick pratique, à glisser dans le sac", "Sensation hydratante appréciée", "Application facile"],
    "Avis partagés sur le parfum et sur les résultats visibles.",
    ["Handy stick format for your bag", "Moisturising feel", "Easy to apply"],
    "Reviews are mixed on the scent and on visible results."),
"taille-sourcils-electrique": (
    ["Précis, sourcils nets en 5 minutes", "Indolore", "Rechargeable et compact"],
    "Pour un résultat net, passez sur une peau propre et sèche.",
    ["Precise, neat brows in 5 minutes", "Painless", "Rechargeable and compact"],
    "For a clean result, use on clean, dry skin."),
"tapis-de-salle-de-bain-magique": (
    ["Doux et moelleux sous le pied", "Absorbant et antidérapant", "Passe en machine"],
    "Il absorbe beaucoup : laissez-le bien sécher entre deux douches.",
    ["Soft and plush underfoot", "Absorbent and non-slip", "Machine washable"],
    "It soaks up a lot: let it dry well between showers."),
"bonnet-anti-migraine": (
    ["Froid et pression enveloppants très appréciés", "Doux, confortable, sans odeur", "Se garde prêt à l'emploi au frais"],
    "Le froid dure un temps limité : remettez-le au frais entre deux usages. Peut serrer sur les grandes têtes.",
    ["Wrap-around cold and pressure is a favourite", "Soft, comfortable, no smell", "Keeps ready to use in the fridge"],
    "The cold lasts a limited time: put it back in the fridge between uses. Can feel snug on larger heads."),
"ceinture-menstruelle": (
    ["Chaleur et vibrations très appréciées", "Autonomie de plusieurs heures citée", "Excellent rapport qualité-prix"],
    "La batterie se vide plus vite à forte intensité ; ressenti variable selon les personnes.",
    ["Warmth and vibration are much appreciated", "Several hours of battery reported", "Excellent value"],
    "The battery drains faster on high settings; how it feels varies from person to person."),
}

# ---------------------------------------------------------------------------
# 60 new products: ratings parsed from sourcing/etude-de-marche.csv,
# likes / note condensed from the "Ce qu'ils adorent" / "Objection" columns.
# ---------------------------------------------------------------------------
NEW = {
"boutons-parlants-chien": (["Le chien comprend vite le principe", "Enregistrement simple, son assez fort", "Lot complet à petit prix"], "Commencez avec 1 ou 2 mots et répétez-les à chaque situation : certains chiens prennent plus de temps."),
"etageres-murales-escalade-chat": (["Bois épais et robuste", "Coussin moelleux, les chats adorent dormir en hauteur", "Notice claire, kit très complet"], "Utilisez des chevilles adaptées à votre mur ; marches un peu rapprochées pour les très grands chats."),
"siege-auto-console-chien": (["Le chien voit son maître sans pouvoir sauter", "Bien rembourré", "Housse zippée lavable"], "Réservé aux petits gabarits : vérifiez le guide des tailles. Montage un peu long la première fois."),
"tente-pliable-chat": (["Les chats l'adoptent très vite", "Très jolie", "Dépasse les attentes, même pour les chats qui aiment se cacher"], "Choisissez bien la taille : plusieurs acheteurs regrettent d'avoir pris trop petit."),
"sac-de-couchage-chat": (["Très chaud et très doux", "Plus grand qu'imaginé", "Parfait pour la saison froide"], "Certains chats s'allongent dessus plutôt que dedans : il reste un coussin douillet."),
"hamac-fenetre-echelle-chat": (["Approuvé par les chats", "Tient bien en place", "Montage étonnamment simple"], "Fixez les ventouses sur une vitre propre et lisse ; certains chats mettent quelques jours à l'adopter."),
"gilet-sauvetage-requin-chien": (["Amusant et pratique", "L'aileron rend le chien bien visible", "Le chien nage librement"], "Mesurez le tour de poitrine : les tailles peuvent tailler grand."),
"pulverisateur-douche-chien": (["Buse réglable qui ne se détache pas", "Efficace même sur poils épais", "Sert aussi à l'évier"], "Le jet reste doux : sa force dépend de la pression de votre réseau."),
"brosse-vapeur-chien": (["Retire les poils morts efficacement", "Les poils ne s'envolent pas", "Picots doux pour la peau"], "Certains animaux sont surpris par la brume : commencez sans vapeur."),
"collier-laser-chat": (["Les chats deviennent fous de joie", "Laser très lumineux", "Devient vite le jouet préféré"], "Il s'utilise aussi à la main si votre chat n'aime pas les colliers. Trop grand pour les chatons."),
"casque-anti-bruit-chien": (["Effet apaisant apprécié", "Utile au toilettage et pendant les orages", "Certains chiens l'adoptent volontiers"], "Il peut glisser si le chien se secoue : ajustez bien le scratch et habituez-le progressivement avec des friandises."),
"gamelle-anti-eclaboussures": (["Fini les gouttes partout dans la maison", "Encourage le chien à boire", "Solide"], "Certains chiots trouvent le moyen de jouer avec l'eau ; le disque peut parfois accrocher."),
"couverture-auto-chauffante": (["Aucune recharge ni prise nécessaire", "Doux et moelleux", "Isole du sol froid"], "Elle renvoie la chaleur du corps grâce à une couche réfléchissante ; plus fine que certains l'imaginent."),
"jouet-porte-oiseau-chat": (["Les chats sautent pendant des heures", "Gazouille sans piles", "Longue corde élastique"], "Les chatons et jeunes chats l'adorent ; certains chats adultes sont moins joueurs."),
"collier-lumineux-led-chien": (["Retrouver son chien dans le noir", "Très lumineux", "Fonctionne toujours après des années"], "C'est un collier de visibilité : il ne remplace pas le collier pour la laisse."),
"gant-anti-poils": (["Ramasse énormément de poils", "Les animaux le vivent comme une caresse", "Efficace sur poils longs"], "Pour les très gros perdeurs, complétez avec une brosse."),
"tapis-fouille-escargot": (["Occupe le chien un long moment", "Il comprend vite comment ouvrir", "Stimule le flair"], "À donner sous surveillance aux chiens destructeurs."),
"gobelet-pliable-feuille": (["Aucune fuite", "Plus grand que prévu", "Silicone souple, se plie en un geste"], "Pensé pour la balade : silicone souple, à rincer après usage."),
"appareil-aide-sommeil": (["Design très apprécié", "Deux modes", "S'intègre bien au rituel du soir"], "Le ressenti varie beaucoup d'une personne à l'autre : c'est un rituel de détente, pas un traitement."),
"sangle-etirement-cou": (["Doux et robuste", "Facile à utiliser chaque jour", "Format compact"], "Restez en douceur : séances courtes, sans forcer, et demandez conseil à un professionnel en cas de doute."),
"masseur-chevilles-chauffant": (["Chauffe bien", "4 modes de vibration", "Se fixe bien, souvent acheté par deux"], "Autonomie plus courte à forte intensité ; se recharge facilement."),
"masseur-tens-nuque": (["Moment de relaxation apprécié", "Chaleur agréable", "Sans fil, facile à emporter"], "Intensité réglable : commencez bas. Déconseillé avec un pacemaker ou pendant la grossesse."),
"porte-cles-anti-stress-touches": (["Addictif, on ne le lâche plus", "Vrai clic de touches mécaniques", "Chaque touche s'allume, piles fournies"], "Le clic s'entend : c'est tout le plaisir, mais pensez à votre entourage."),
"pinces-acupression-mains": (["Plus pratiques que des pinces à linge", "Compactes et discrètes", "Faciles à emporter"], "Ressenti très personnel ; les pinces sont assez petites."),
"anneaux-massage-su-jok": (["Gadget détente utilisé au quotidien", "Occupe la main en lisant", "Idée cadeau appréciée"], "Certains anneaux s'usent à usage intensif : c'est pourquoi ils sont vendus en lot."),
"entraineur-respiratoire": (["Simple d'utilisation", "Plus utile que prévu", "Apprécié des coureurs et vététistes"], "Nettoyez-le avant la première utilisation pour éviter l'odeur de plastique."),
"lunettes-ambrees-soir": (["Accessoire du soir adopté au quotidien", "Légères et confortables, même avec un casque", "Filtrent bien la lumière bleue selon les acheteurs"], "Les couleurs prennent une teinte orangée : c'est le principe."),
"rouleau-glace-visage": (["Sensation de fraîcheur agréable", "Se garde au congélateur", "Petit prix"], "Il reste froid quelques minutes : juste le temps du rituel."),
"bouchons-oreilles-silicone": (["Réduction du bruit efficace", "Comparables à une grande marque", "Confortables même pour conduits étroits"], "Ils atténuent fortement sans créer un silence total, surtout sur les basses fréquences."),
"tapis-ems-pieds": (["Moment de détente apprécié", "Nombreux modes et intensités", "Patchs pour d'autres zones"], "Gardez le mode d'emploi à portée : la notice d'origine est en anglais."),
"projecteur-ondulations-eau": (["Ambiance très apaisante", "On reste des heures à regarder le plafond", "16 couleurs au choix"], "L'effet est maximal dans une pièce sombre."),
"reveil-projecteur-plafond": (["L'heure lisible au plafond, sans bouger", "Projection superbe", "Luminosité réglable"], "Alimentation USB ; piles de sauvegarde non incluses."),
"tableau-led-acrylique": (["Bel éclat, encore mieux qu'en photo", "Léger", "Livré avec marqueurs, chiffon et support"], "Surface délicate : nettoyez avec le chiffon fourni, sans frotter fort."),
"lampe-bouteille-vin": (["Se pose dans le col en une seconde", "Trois teintes, luminosité réglable", "Souvent rachetée pour la maison et le jardin"], "Testez la batterie à réception ; autonomie variable selon l'intensité."),
"humidificateur-effet-flamme": (["Ambiance cheminée très réussie", "Brume et LED du plus bel effet", "Compact, en USB-C"], "Format compact, proche de la taille d'un smartphone."),
"terrarium-mural-hydroponique": (["Très joli et décoratif", "Plantes qui s'y développent depuis plus d'un an", "Facile à composer"], "Ce sont de petites sphères : idéales en série, comme mini-terrariums. Verre délicat."),
"rallonge-robinet-360": (["Élégant et pratique", "S'adapte parfaitement", "Aucune fuite"], "Vérifiez le diamètre de votre robinet ; surveillez le calcaire en eau dure."),
"mini-lampe-murale-rechargeable": (["Lampe de chevet tactile sur batterie", "Fixation aimantée qui tient bien", "Bonne autonomie"], "Plus petite qu'imaginé pour certains acheteurs."),
"pot-auto-arrosant": (["Parfait pour aromatiques et succulentes", "Joli design", "Souvent recommandé"], "Pots compacts, pour petites plantes et boutures."),
"vase-ampoule-hydroponique": (["Design élégant et moderne", "Bois de qualité, verre épais", "Côté vintage réussi"], "Verre épais et bien emballé selon les acheteurs."),
"tapis-robinet-silicone": (["Se pose parfaitement au bord de l'évier", "Assez souple pour suivre la forme", "Qualité qui surprend"], "Essuyez de temps en temps les traces d'eau."),
"barre-flexible-avant-bras": (["Plusieurs niveaux de résistance", "Bonne qualité", "Appréciée des joueurs de tennis"], "Choisissez la couleur selon la résistance souhaitée ; la matière peut faire transpirer."),
"planche-etirement-mollets": (["Base stable", "Très solide, supporte bien le poids", "Indispensable pour s'étirer à la maison"], "Utilisez-la avec des chaussures ou des chaussettes antidérapantes."),
"rouleau-poignet-reglable": (["Exercice redoutable pour la poigne", "Poignée épaisse et antidérapante", "Réglable"], "Les poids ne sont pas fournis : accrochez votre propre disque ou kettlebell."),
"entraineur-plancher-pelvien": (["S'utilise n'importe quand, même devant la télé", "Compact", "Résistance suffisante"], "Résistance fixe, non réglable."),
"barre-pilates-portable": (["Accessible même aux débutants", "Tableau d'exercices très utile", "Légère et facile à ranger"], "Résistance douce : idéale pour tonifier, moins pour les sportifs confirmés."),
"planche-pompes-multifonction": (["Idéale pour débuter les pompes", "Plusieurs positions pour cibler pectoraux, épaules, dos", "Planche robuste"], "Les élastiques fournis sont plus basiques que la planche."),
"briques-squat-inclinees": (["Ne glissent pas", "Plus robustes que prévu", "Légères, faciles à emporter"], "2 cales douces et 1 plus marquée."),
"ceinture-ems-abdos": (["Comparée favorablement à des modèles de marque", "Nombreux modes", "Sans fil"], "C'est un complément à l'entraînement, pas une solution minceur."),
"hula-hoop-leste": (["Séance qui fait vite transpirer", "Silencieux", "Mieux que d'autres modèles testés"], "Certaines pièces s'usent en usage quotidien intensif."),
"balle-reflexe-boxe": (["Améliore coordination et timing", "Très ludique, à plusieurs", "Progression rapide"], "Un petit temps d'adaptation au début, puis on progresse vite."),
"disques-glisse": (["Simple mais très efficace pour les abdos", "Parfaits pour reprendre le sport", "Utilisables sur parquet"], "Choisissez la face adaptée à votre revêtement de sol."),
"chaussettes-pilates": (["Confortables", "Fines et adhérentes au sol", "Tiennent bien au talon"], "Tissu fin, mais bon maintien selon les acheteurs."),
"corde-sauter-sans-fil": (["Câble acier gainé de silicone", "Longueur réglable", "Poignées en mousse confortables"], "Corde fine et légère, mais résistante selon les avis."),
"hand-grip-compteur": (["Réglable", "Robuste et ergonomique", "Un des achats préférés des acheteurs"], "Progressez à votre rythme en augmentant la résistance petit à petit."),
"anneau-pilates": (["Utilisé au quotidien sans souci", "Bon pour les étirements", "Poignées confortables"], "La résistance peut s'assouplir avec le temps : parfait pour tonifier en douceur."),
"tendeur-pedale": (["Facile à utiliser", "Excellent rapport qualité-prix", "Souvent racheté"], "Élastiques jugés légers par les sportifs confirmés ; pédale étroite pour les grandes pointures."),
"sangles-poignet": (["Indispensables en musculation selon les habitués", "Robustes", "Mousse confortable au poignet"], "Vérifiez le sens de chaque sangle à réception."),
"balle-massage-cacahuete": (["Très ferme, idéale pour le massage", "Forme pratique pour le dos", "Petit format"], "Très ferme : commencez doucement, sur un tapis."),
"genouillere-silicone": (["Bon maintien de la rotule", "Confortable", "Agréable à porter"], "C'est un maintien de confort, pas un dispositif médical."),
}


def num(s):
    return float(s.replace(",", "."))


def parse_new_sources(text):
    """'AliExpress 4,9★ (30 avis) · Amazon.fr 4,3★ (385 avis, modèle équivalent)'"""
    out = []
    for part in text.split("·"):
        m = re.search(r"(AliExpress|Amazon\.fr)\s+(\d,\d)★\s*\(([\d\s  ]+)avis([^)]*)\)", part)
        if not m:
            continue
        site, rating, count, rest = m.groups()
        if "différent" in rest:
            continue  # not the same kind of product
        out.append({
            "site": site,
            "rating": num(rating),
            "count": int(re.sub(r"\D", "", count)),
            "basis": "même modèle" if site == "AliExpress" else "modèle équivalent",
        })
    return out


def build():
    fr, en = {}, {}
    for h, (r, c) in AMZ.items():
        lf, nf, le, ne = OLD[h]
        fr[h] = {"lang": "fr", "sources": [{"site": "Amazon.fr", "rating": r, "count": c, "basis": "modèle équivalent"}], "likes": lf, "note": nf}
        en[EN_HANDLE[h]] = {"lang": "en", "sources": [{"site": "Amazon.fr", "rating": r, "count": c, "basis": "similar model"}], "likes": le, "note": ne}
    rows = csv.DictReader(open(ROOT / "sourcing/etude-de-marche.csv", encoding="utf-8-sig"), delimiter=";")
    for row in rows:
        h = row["Handle"]
        likes, note = NEW[h]
        fr[h] = {"lang": "fr", "sources": parse_new_sources(row["Avis clients"]), "likes": likes, "note": note}
    missing = set(NEW) - set(fr)
    assert not missing, missing
    # One combined score per product: average of the sources weighted by their review counts
    # (a 4.9 from 30 reviews must not weigh as much as a 4.3 from 385).
    for d in [*fr.values(), *en.values()]:
        total = sum(s["count"] for s in d["sources"])
        d["count"] = total
        d["rating"] = round(sum(s["rating"] * s["count"] for s in d["sources"]) / total, 1)
    return fr, en


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
        first = bool(r[ti])  # metafields are read from the product's first row
        r[i] = json.dumps(data[r[hi]], ensure_ascii=False) if first and r[hi] in data else ""
        n += bool(r[i])
    out = io.StringIO()
    csv.writer(out, delimiter=";").writerows(rows)
    text = out.getvalue()
    if not raw.endswith("\n"):  # keep the file's original (missing) final newline
        text = text[:-2]
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print(f"{path.name}: {n} products with a buyer summary")


if __name__ == "__main__":
    fr, en = build()
    (ROOT / "sourcing/avis-acheteurs.json").write_text(json.dumps({"fr": fr, "en": en}, ensure_ascii=False, indent=1))
    print(f"FR {len(fr)} · EN {len(en)}")
    for name, data in [("products.csv", fr), ("products-20.csv", fr), ("products-en.csv", en), ("products-20-en.csv", en)]:
        add_column(ROOT / "public" / name, data)
