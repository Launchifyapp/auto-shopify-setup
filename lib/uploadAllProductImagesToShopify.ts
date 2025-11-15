import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { fileTypeFromBuffer } from "file-type";

// ---------------------------------------------------
// CONFIGURATION
const IMAGES_DIR = "./public/products_images/"; // Dossier contenant toutes tes images locales (jpg, png, webp...)
const SHOP_URL = "YOUR_SHOP_NAME.myshopify.com"; // ← Ici ton shop, ex: "demo-store.myshopify.com"
const TOKEN = "YOUR_API_TOKEN"; // ← Ici ton token Shopify admin API
const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv"; // Idéalement, le CSV utilisé pour l'import

// 1. Fonction utilitaire pour récupérer toutes les lignes du CSV produits
async function getCsvRecords(csvUrl: string) {
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  return parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });
}

// 2. Fonction pour détecter le filename local à partir de l'URL "Image Src" (du CSV)
function extractFilenameFromShopifyUrl(url: string): string {
  const lastSlash = url.lastIndexOf("/");
  if (lastSlash < 0) return url;
  const fileWithParams = url.substring(lastSlash + 1);
  const [filename] = fileWithParams.split("?"); // ignore query params
  return filename;
}

// 3. Upload l'image locale en base64 vers Shopify Files API (fileCreate)
async function uploadImageToShopifyBase64(filePath: string, filename: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length === 0) throw new Error(`Image vide: ${filename}`);
  if (buffer.length > 20 * 1024 * 1024) throw new Error(`Image trop volumineuse (>20Mo): ${filename}`);

  const type = await fileTypeFromBuffer(buffer);
  const mimeType = type?.mime || (
    filename.toLowerCase().endsWith('.png') ? "image/png"
      : filename.toLowerCase().endsWith('.webp') ? "image/webp"
      : "image/jpeg"
  );
  const base64Content = buffer.toString("base64");

  const res = await fetch(`https://${SHOP_URL}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { url }
            userErrors { field message }
          }
        }
      `,
      variables: {
        files: [{
          originalFileName: filename,
          mimeType,
          content: base64Content
        }]
      }
    })
  });

  const json = await res.json();
  if (json.data?.fileCreate?.userErrors?.length) {
    console.error("Shopify fileCreate userErrors:", json.data.fileCreate.userErrors);
  }
  if (json.data?.fileCreate?.files?.[0]?.url) {
    return json.data.fileCreate.files[0].url;
  }
  throw new Error("Upload image failed for " + filename + " | " + JSON.stringify(json));
}

// 4. Fonctions pour rattacher l'image _au produit_ ou _à la variante_ (via GraphQL)
// Utilise le productId (gid://shopify/Product/xxxx) ou variantId (gid://shopify/ProductVariant/xxxx)
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

// ---------------------------------------------------
// MAIN PIPELINE: boucle sur toutes les lignes du CSV, upload chaque image locale en base64, log via la console

(async () => {
  const records = await getCsvRecords(csvUrl);

  // Si tu as déjà les mappings produits/variants, charge-les ici !
  // Sinon, pour rattacher l'image, requête l'id produit Shopify par handle (exemple ci-dessous)
  async function getProductIdByHandle(handle: string): Promise<string | undefined> {
    const res = await fetch(`https://${SHOP_URL}/admin/api/2023-10/graphql.json`, {
      method: "POST",
      headers: {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
      body: JSON.stringify({
        query: `
          query($handle: String!){
            productByHandle(handle: $handle) { id }
          }
        `,
        variables: { handle }
      })
    });
    const json = await res.json();
    return json.data?.productByHandle?.id;
  }

  // Tu peux aussi faire une requête REST ou GraphQL pour variant ID si tu as besoin d'attacher à chaque variant.

  let countSuccess = 0, countFailed = 0, failedImages:string[] = [];

  for (const record of records) {
    // 1. Trouve le fichier image locale
    const urlInCsv = record["Image Src"];
    const filename = extractFilenameFromShopifyUrl(urlInCsv);
    if (!filename) continue;

    const localImgPath = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(localImgPath)) {
      console.warn("Image manquante dans le dossier local:", filename);
      countFailed++;
      failedImages.push(filename + " (not found)");
      continue;
    }

    let cdnUrl;
    try {
      cdnUrl = await uploadImageToShopifyBase64(localImgPath, filename);
      console.log("Image uploadée:", filename, "→ Shopify CDN:", cdnUrl);
    } catch (err) {
      console.error("Erreur upload", filename, err);
      countFailed++;
      failedImages.push(filename + " (upload error)");
      continue;
    }

    // 2. Mapping produit via le Handle (du CSV)
    const handle = record["Handle"];
    const productId = await getProductIdByHandle(handle);

    if (!productId) {
      console.error("Impossible de récupérer l’id Shopify du produit pour handle:", handle);
      countFailed++;
      failedImages.push(filename + " (no productId)");
      continue;
    }

    // 3. Rattache au produit principal (pas de mapping variant ici, tu étends si tu veux à la variante !)
    const altText = record["Image Alt Text"] ?? "";
    try {
      await attachImageToProduct(productId, cdnUrl, altText);
      console.log(`Image ${filename} rattachée au produit: ${handle} → ${productId}`);
      countSuccess++;
    } catch (err) {
      console.error("Erreur attach image au produit", filename, err);
      countFailed++;
      failedImages.push(filename + " (attach error)");
    }

    await new Promise(res => setTimeout(res, 250)); // evite throttling Shopify
  }

  console.log(`✔️ Images Shopify: ${countSuccess} uploadées. ❌ ${countFailed} en erreur.`);
  if (failedImages.length) console.log("Images en erreur :", failedImages);

  console.log("Fin du pipeline image !");
})();
