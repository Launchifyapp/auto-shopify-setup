import path from "node:path";
import { uploadAllImages } from "../lib/shopify.js"; // ajuste le chemin selon ton projet

export default async function handler(req, res) {
  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;

    const seedDir = path.join(process.cwd(), "public", "seed");
    const filesJsonPath = path.join(seedDir, "files.json");

    const imagesMap = await uploadAllImages({
      shop,
      accessToken,
      filesJsonPath,
      imagesDir: seedDir,
    });

    // Par exemple, log ou renvoie la map :
    return res.status(200).json({ ok: true, images: imagesMap });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
