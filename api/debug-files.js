import fs from "node:fs/promises";
import path from "node:path";

export default async function handler(req, res) {
  try {
    const dir = path.join(process.cwd(), "public", "seed");
    const files = await fs.readdir(dir);
    return res.status(200).json({ ok: true, dir, files });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
