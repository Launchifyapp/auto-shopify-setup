// api/setup-lite.js
import path from "node:path";
import { importProductsFromCsv } from "../lib/shopify.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookies" });
    }

    // IMPORTANT : chemin vers ton CSV dans /public/seed
    const csvPath = path.join("public", "seed", "products.csv");

    const result = await importProductsFromCsv({ shop, accessToken, csvPath });
    return res.status(200).json(result);
  } catch (err) {
    console.error("SETUP-LITE ERROR", err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
