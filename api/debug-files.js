// api/debug-files.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default async function handler(req, res) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const seedDir = path.resolve(__dirname, "../public/seed");

    const entries = await fs.readdir(seedDir);
    return res.status(200).json({ ok: true, seedDir, entries });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message) });
  }
}
