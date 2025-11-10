// api/setup.js
import path from "node:path";
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections
} from "../lib/shopify.js";
import { upsertProductMetafieldDefinitions } from "../lib/metafields.js";

const PRODUCT_METAFIELDS = [
  { name: "Sous-titre", namespace: "custom", key: "subtitle", type: "single_line_text_field" },
  { name: "USP",        namespace: "custom", key: "usp",      type: "list.single_line_text_field" },
  { name: "Vidéo",      namespace: "custom", key: "video",    type: "url" }
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) {
      res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
      return;
    }

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 1) Metafields produit
    await upsertProductMetafieldDefinitions({ shop, accessToken, definitions: PRODUCT_METAFIELDS });

    // 2) Import CSV
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Upload images
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 4) Pages
    await upsertPage({
      shop, accessToken, handle: "livraison", title: "Livraison",
      html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>"
    });
    await upsertPage({
      shop, accessToken, handle: "faq", title: "FAQ",
      html: "<h1>FAQ</h1><p>Questions fréquentes…</p>"
    });

    // 5) Menu principal FR
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections intelligentes
    await createCollections({ shop, accessToken });

    // Redirige vers une page de succès (ou renvoie JSON si tu préfères)
    const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/setup/done`;
    res.writeHead(302, { Location: redirectUrl });
    res.end();
  } catch (err) {
    console.error("SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
