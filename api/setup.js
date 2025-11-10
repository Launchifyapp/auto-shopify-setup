// api/setup.js
import { upsertThreeCheckboxMetafields } from "../lib/metafields.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    // 1) Récupère shop & accessToken depuis cookies (posés par /api/callback)
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;

    if (!shop || !accessToken) {
      return res.status(401).json({
        ok: false,
        error: "Missing 'shop' or 'accessToken' cookie. Réinstalle l'app pour poser les cookies via /api/callback."
      });
    }

    // 2) Étape 1 uniquement : créer les 3 metafield definitions produit
    const metafields = await upsertThreeCheckboxMetafields({ shop, accessToken });

    return res.status(200).json({
      ok: true,
      step: "metafields",
      metafields
    });
  } catch (err) {
    console.error("SETUP ERROR", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
