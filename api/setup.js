// api/setup.js

import path from "node:path";
import { upsertProductMetafieldDefinitions } from "../lib/metafields.js";
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections
} from "../lib/shopify.js";

const PRODUCT_METAFIELDS = [
  { name: "Sous-titre", namespace: "custom", key: "subtitle", type: "single_line_text_field" },
  { name: "USP", namespace: "custom", key: "usp", type: "list.single_line_text_field" },
  { name: "Vidéo", namespace: "custom", key: "video", type: "url" }
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;

    if (!shop || !accessToken) {
      return res.status(401).json({ error: "Missing authentication cookies" });
    }

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 1) Metafields produit
    await upsertProductMetafieldDefinitions({ shop, accessToken, definitions: PRODUCT_METAFIELDS });

    // 2) Import produits CSV
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Upload images de /public/seed
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 4) Pages
    await upsertPage({ shop, accessToken, handle: "livraison", title: "Livraison", html: "<h1>Livraison</h1><p>Informations de livraison.</p>" });
    await upsertPage({ shop, accessToken, handle: "faq", title: "FAQ", html: "<h1>FAQ</h1><p>Questions fréquentes.</p>" });

    // 5) Menu principal FR
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections automatiques par tags
    await createCollections({ shop, accessToken });

    // Redirection finale vers une page de confirmation (tu la créeras ensuite)
    res.writeHead(302, { Location: "/setup/done" });
    res.end();
  } catch (err) {
    console.error("Setup error:", err);
    res.status(500).json({ error: "Setup failed", details: err.message });
  }
}
