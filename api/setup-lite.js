// api/setup-lite.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default async function handler(req, res) {
  try {
    // Chemin absolu vers /public/seed/products.csv dans le bundle
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const csvPath = path.resolve(__dirname, "../public/seed/products.csv");

    const csv = await fs.readFile(csvPath, "utf8");
    // ... ton import CSV ici ...
    return res.status(200).json({ ok: true, bytes: csv.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err.message) });
  }
}
