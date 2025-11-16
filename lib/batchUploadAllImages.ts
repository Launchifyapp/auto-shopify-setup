import fs from "fs";
import path from "path";
import { uploadShopifyImage } from "./shopifyImageUpload";

const IMAGES_DIR = "./public/products_images/";
const PUBLIC_BASE = "https://auto-shopify-setup.vercel.app";
const SHOP = "monshop.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

function getAllImageFiles(): string[] {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && fs.statSync(path.join(IMAGES_DIR, f)).size > 0)
    .map(f => f);
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

(async () => {
  const files = getAllImageFiles();
  let countSuccess = 0, countFail = 0, failedFiles: string[] = [];
  for (const filename of files) {
    const url = `${PUBLIC_BASE}/products_images/${filename}`;
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
