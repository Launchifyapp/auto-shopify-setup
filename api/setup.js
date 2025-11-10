// api/setup.js
import path from "node:path";
import {
  // tes fonctions déjà existantes :
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections,

  // les nouvelles ci-dessous si tu les as mis dans le même fichier
  upsertProductMetafieldDefinitionsREST,
  ensureSmartCollectionsByTags
} from "../lib/shopify.js";

export default async function handler(req, res) {
  // Pour tester une seule étape: /api/setup?step=metafields (ou csv, images, pages, menu, collections)
  const only = (req.query?.step || "").toLowerCase();

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    const results = {};

    // 1) Metafield definitions (Checkbox 1/2/3)
    if (!only || only === "metafields") {
      const defs = [
        { name: "Checkbox 1", namespace: "custom", key: "checkbox_1", type: "single_line_text_field" },
        { name: "Checkbox 2", namespace: "custom", key: "checkbox_2", type: "single_line_text_field" },
        { name: "Checkbox 3", namespace: "custom", key: "checkbox_3", type: "single_line_text_field" }
      ];
      await upsertProductMetafieldDefinitionsREST({ shop, accessToken, definitions: defs });
      results.metafields = "ok";
      if (only) return res.status(200).json({ ok: true, results });
    }

    // 2) Import CSV
    if (!only || only === "csv") {
      await importProductsFromCsv({ shop, accessToken, csvPath });
      results.csv = "ok";
      if (only) return res.status(200).json({ ok: true, results });
    }

    // 3) Upload images
    if (!only || only === "images") {
      await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });
      results.images = "ok";
      if (only) return res.status(200).json({ ok: true, results });
    }

    // 4) Pages
    if (!only || only === "pages") {
      await upsertPage({ shop, accessToken, handle: "livraison", title: "Livraison", html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>" });
      await upsertPage({ shop, accessToken, handle: "faq",       title: "FAQ",       html: "<h1>FAQ</h1><p>Questions fréquentes…</p>" });
      results.pages = "ok";
      if (only) return res.status(200).json({ ok: true, results });
    }

    // 5) Menu FR
    if (!only || only === "menu") {
      await upsertMainMenuFR({ shop, accessToken });
      results.menu = "ok";
      if (only) return res.status(200).json({ ok: true, results });
    }

    // 6) Collections intelligentes par tags (simple)
    if (!only || only === "collections") {
      await ensureSmartCollectionsByTags({
        shop,
        accessToken,
        tags: ["Beauté & soins", "Maison & confort"]
      });
      results.collections = "ok";
      if (only) return res.status(200).json({ ok: true, results });
    }

    // Quand tout passe en vert, tu peux rediriger vers une page "done"
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error("SETUP ERROR", err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
