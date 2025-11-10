// api/setup-lite.js (Pages Router)
import path from "node:path";
import { importProductsFromCsvGrouped, uploadAllImages } from "../lib/shopify.js";

export default async function handler(req, res) {
  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 1) Uploader les images d'abord et récupérer une map filename -> URL
    const fileUrlMap = await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 2) Importer les produits en utilisant la map pour résoudre les "Image Src" locaux
    const result = await importProductsFromCsvGrouped({ shop, accessToken, csvPath, fileUrlMap });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("SETUP-LITE ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
