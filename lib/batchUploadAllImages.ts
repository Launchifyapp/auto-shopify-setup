import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";

// CONFIG
const SHOP_URL = process.env.SHOPIFY_STORE!;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const API_UPLOAD_URL = "http://localhost:3000/api/upload-file";
const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image4.jpg",
  "./public/image4.webp"
];
const CSV_URL = "https://auto-shopify-setup.vercel.app/products.csv";

// Utilitaire : upload via staged (le endpoint Next.js upload-file.ts)
async function stagedUpload(filepath: string, filename: string, mimeType: string) {
  const fileurl = "file://" + filepath;
  // POST le fichier vers l'API upload-file, on suppose qu'il gère le file local
  const res = await fetch(API_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: fileurl, filename, mimeType })
  });
  const json = await res.json();
  if (json.ok && json.uploads?.[0]?.result?.data?.fileCreate?.files?.[0]?.preview?.image?.url) {
    const cdnUrl = json.uploads[0].result.data.fileCreate.files[0].preview.image.url;
    return cdnUrl;
  } else {
    throw new Error("Staged upload error: " + JSON.stringify(json));
  }
}

// Utilitaire pour productId Shopify
async function getProductIdByHandle(handle: string): Promise<string | undefined> {
  const res = await fetch(`https://${SHOP_URL}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    body: JSON.stringify({
      query: `query($handle: String!){productByHandle(handle:$handle){id}}`,
      variables: { handle }
    })
  });
  const json = await res.json();
  return json.data?.productByHandle?.id;
}

// Rattachement media au produit Shopify
async function attachImageToProduct(productId: string, imageUrl: string, altText: string = "") {
  const media = [{
    originalSource: imageUrl,
    mediaContentType: "IMAGE",
    alt: altText
  }];
  const res = await fetch(`https://${SHOP_URL}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    body: JSON.stringify({
      query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { id alt }
            userErrors { field message }
          }
        }
      `,
      variables: { productId, media }
    })
  });
  const json = await res.json();
  if (json.data?.productCreateMedia?.userErrors?.length) {
    console.error("Erreur productCreateMedia:", JSON.stringify(json.data.productCreateMedia.userErrors));
  }
  return json;
}

(async () => {
  // --- UPLOAD (+ ratachement produit) POUR CHAQUE IMAGE DU DOSSIER ---
  // Charge CSV mapping
  const response = await fetch(CSV_URL);
  const csvText = await response.text();
  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });
  const mapping: Record<string, any> = {};
  records.forEach(r => {
    const handle = r["Handle"];
    const imageUrl = r["Image Src"];
    const filename = imageUrl.substring(imageUrl.lastIndexOf("/") + 1).split("?")[0];
    mapping[filename] = { handle, alt: r["Image Alt Text"] };
  });

  // Upload & rattachement pour images du dossier
  const files = fs.readdirSync(IMAGES_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  for (const filename of files) {
    const filePath = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(filePath)) continue;
    const mimeType = filename.endsWith(".png") ? "image/png"
      : filename.endsWith(".webp") ? "image/webp"
      : "image/jpeg";
    try {
      const cdnUrl = await stagedUpload(filePath, filename, mimeType);
      console.log(`[PRODUCT IMAGE] ${filename} uploaded → ${cdnUrl}`);

      // Si mapping CSV existe, rattacher au produit
      if (mapping[filename]) {
        const handle = mapping[filename].handle;
        const alt = mapping[filename].alt || filename;
        const productId = await getProductIdByHandle(handle);
        if (productId) {
          await attachImageToProduct(productId, cdnUrl, alt);
          console.log(`[PRODUCT IMAGE] ${filename} attached to ${productId}`);
        } else {
          console.warn(`[PRODUCT IMAGE] No productId for handle ${handle}`);
        }
      }
    } catch (err) {
      console.error(`[PRODUCT IMAGE ERROR] ${filename}`, err);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  // --- Upload SEULEMENT pour les images libres ---
  for (const imgPath of EXTRA_IMAGES) {
    if (!fs.existsSync(imgPath)) {
      console.warn(`[SPECIAL IMAGE] ${imgPath} not found!`);
      continue;
    }
    const filename = path.basename(imgPath);
    const mimeType = filename.endsWith(".png") ? "image/png"
      : filename.endsWith(".webp") ? "image/webp"
      : "image/jpeg";
    try {
      const cdnUrl = await stagedUpload(imgPath, filename, mimeType);
      console.log(`[SPECIAL IMAGE] ${filename} uploaded (not attached) → ${cdnUrl}`);
      // Pas de rattachement produit
    } catch (err) {
      console.error(`[SPECIAL IMAGE ERROR] ${filename}`, err);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log("Batch upload TERMINÉ!");
})();
