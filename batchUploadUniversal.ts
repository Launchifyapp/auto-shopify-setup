import fs from "fs";
import path from "path";
import { uploadShopifyImage } from "./shopifyImageUpload";

const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image3.jpg",
  "./public/image4.webp"
];
const PUBLIC_BASE = "https://auto-shopify-setup.vercel.app";

const SHOP = "monshop.myshopify.com"; // À adapter
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

/**
 * Retourne tous les fichiers images valides du dossier
 */
function getAllImageFiles(): string[] {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && fs.statSync(path.join(IMAGES_DIR, f)).size > 0)
    .map(f => path.join(IMAGES_DIR, f));
}

/**
 * Retourne le mimeType à partir du nom de fichier
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

(async () => {
  const imageFiles = getAllImageFiles();
  const extraFiles = EXTRA_IMAGES.filter(f => fs.existsSync(f) && fs.statSync(f).size > 0);

  // Tous les fichiers à uploader, sans doublons
  const allFiles = [...imageFiles, ...extraFiles];

  let countSuccess = 0, countFail = 0, failedFiles: string[] = [];
  for (const filePath of allFiles) {
    const filename = path.basename(filePath);

    // Détermine l'URL publique à partir du chemin
    let url;
    if (filePath.startsWith(IMAGES_DIR)) {
      url = `${PUBLIC_BASE}/products_images/${filename}`;
    } else {
      url = `${PUBLIC_BASE}/${filename}`;
    }
    const mimeType = getMimeType(filename);

    try {
      const result = await uploadShopifyImage({
        url,
        filename,
        mime_type: mimeType,
        shop: SHOP,
        token: TOKEN
      });
      console.log(`[UPLOAD SUCCESS] ${filename}:`, result);
      countSuccess++;
    } catch (err) {
      console.error(`[UPLOAD ERROR] ${filename}`, err);
      countFail++;
      failedFiles.push(filename);
    }
    await new Promise(r => setTimeout(r, 500)); // anti-throttle Shopify
  }
  console.log(`✔️ ${countSuccess} images uploadées. ❌ ${countFail} erreurs.`);
  if (countFail) console.log("Images en erreur:", failedFiles);
})();
