import type { Language } from "@/lib/i18n";

/**
 * Store niches sold in the funnel. Each niche has its own product CSV in public/:
 * products-<niche>.csv (FR) and, when translated, products-<niche>-en.csv.
 * The CSVs list 20 products, the 10 core products first (built by sourcing/build_niche_csvs.py).
 */
export const NICHES = ["beaute", "bien-etre", "maison", "animaux", "sport"] as const;
export type Niche = (typeof NICHES)[number];

/** Licenses activated before niches existed have no niche: they get the beauty catalog. */
export const DEFAULT_NICHE: Niche = "beaute";

export function isNiche(value: unknown): value is Niche {
  return typeof value === "string" && (NICHES as readonly string[]).includes(value);
}

/**
 * Collection created for the niche. The title doubles as the product tag the automated
 * collection filters on, so it must match NICHE_TAG in sourcing/build_niche_csvs.py.
 */
export const NICHE_COLLECTION: Record<Niche, Record<Language, { title: string; handle: string }>> = {
  beaute: {
    fr: { title: "Beauté & soins", handle: "beaute-soins" },
    en: { title: "Beauty & Care", handle: "beauty-care" },
  },
  "bien-etre": {
    fr: { title: "Bien-être & relaxation", handle: "bien-etre-relaxation" },
    en: { title: "Wellness & Relaxation", handle: "wellness-relaxation" },
  },
  maison: {
    fr: { title: "Maison & cocooning", handle: "maison-cocooning" },
    en: { title: "Home & Comfort", handle: "home-comfort" },
  },
  animaux: {
    fr: { title: "Animaux", handle: "animaux" },
    en: { title: "Pets", handle: "pets" },
  },
  sport: {
    fr: { title: "Sport & fitness", handle: "sport-fitness" },
    en: { title: "Sport & Fitness", handle: "sport-fitness" },
  },
};

/** Core products carry this tag (CORE_TAG in sourcing/build_niche_csvs.py). */
export const BEST_SELLER_TAG = "Best-seller";

export const BEST_SELLER_COLLECTION: Record<Language, { title: string; handle: string }> = {
  fr: { title: "Les plus vendus", handle: "les-plus-vendus" },
  en: { title: "Best sellers", handle: "best-sellers" },
};
