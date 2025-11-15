import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { fileTypeFromBuffer } from "file-type";

// Chemins de mapping produits/variantes générés par setupShop.ts
const PRODUCT_MAPPING_PATH = "./productHandleToId.json";
const VARIANT_MAPPING_PATH = "./variantKeyToId.json";

// Paramétrage
const IMAGES_DIR = "./public/products_images/";
const SHOP_URL = "YOUR_SHOP_NAME.myshopify.com"; // ← À personnaliser
const TOKEN = "YOUR_API_TOKEN"; // ← À personnaliser

// Utilitaire CSV
async function getCsvRecords(csvUrl: string) {
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  return parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });
}

// Utilitaires mapping
const productHandleToId = JSON.parse(fs.readFileSync(PRODUCT_MAPPING_PATH, "utf8")); // {handle: productId}
const variantKeyToId = JSON.parse(fs.readFileSync(VARIANT_MAPPING_PATH, "utf8"));     // {handle:option:...: variantId}

// Utilitaire images
function extractFilenameFromShopifyUrl(url: string): string {
  const lastSlash = url.lastIndexOf("/");
  if (lastSlash < 0) return url;
  const fileWithParams = url.substring(lastSlash + 1);
  const [filename] = fileWithParams.split("?"); // ignore query params
  return filename;
}

// Upload image locale vers Shopify Files
async function uploadImageToShopify(filePath: string, filename: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length === 0) throw new Error(`Image vide: ${filename}`);
  if (buffer.length > 20 * 1024 * 1024) throw new Error(`Image trop volumineuse (>20Mo): ${filename}`);
  const type = await fileTypeFromBuffer(buffer);
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  const mimeType = type?.mime ||
    (ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
     ext === "png" ? "image/png" :
     ext === "webp" ? "image/webp" :
     "application/octet-stream");
  const encoded = buffer.toString("base64");
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
          content: encoded
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

// Attacher une image au produit Shopify
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

// Rattacher une image à une variante Shopify
async function attachImageToVariant(variantId: string, imageUrl: string, altText: string = "") {
  const res = await fetch(`https://${SHOP_URL}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({
      query: `
        mutation productVariantUpdate($input: ProductVariantUpdateInput!) {
          productVariantUpdate(input: $input) {
            productVariant { id image { id src altText } }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: {
          id: variantId,
          image: { src: imageUrl, altText }
        }
      }
    })
  });
  const json = await res.json();
  if (json.data?.productVariantUpdate?.userErrors?.length) {
    console.error("Erreur productVariantUpdate:", JSON.stringify(json.data.productVariantUpdate.userErrors));
  }
  return json;
}

(async () => {
  const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
  const records = await getCsvRecords(csvUrl);

  for (const record of records) {
    // 1. Récupère le nom de fichier local depuis l’URL ("Image Src")
    const urlInCsv = record["Image Src"];
    const filename = extractFilenameFromShopifyUrl(urlInCsv);
    if (!filename) continue;

    const localImgPath = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(localImgPath)) {
      console.warn("Image manquante dans le dossier local:", filename);
      continue;
    }

    // 2. Upload l'image vers Shopify Files
    let cdnUrl;
    try {
      cdnUrl = await uploadImageToShopify(localImgPath, filename);
      console.log("Image uploadée:", filename, "-> CDN:", cdnUrl);
    } catch (err) {
      console.error("Erreur upload", filename, err);
      continue;
    }

    // 3. Mapping produit
    const handle = record["Handle"];
    const productId = productHandleToId[handle];

    // 4. Mapping variante si existant
    const optionKeyArr = [];
    if (record["Option1 Value"]) optionKeyArr.push(record["Option1 Value"].trim());
    if (record["Option2 Value"]) optionKeyArr.push(record["Option2 Value"].trim());
    if (record["Option3 Value"]) optionKeyArr.push(record["Option3 Value"].trim());
    const variantKey = handle + ":" + optionKeyArr.join(":");
    const variantId = variantKeyToId[variantKey];

    // 5. Rattache au produit principal
    if (productId) {
      await attachImageToProduct(productId, cdnUrl, record["Image Alt Text"] ?? "");
      console.log(`Image rattachée au produit: ${handle} → ${productId}`);
    }

    // 6. (Optionnel) Rattache à la variante si besoin
    if (variantId && optionKeyArr.length) {
      await attachImageToVariant(variantId, cdnUrl, record["Image Alt Text"] ?? "");
      console.log(`Image rattachée à variante: ${variantKey} → ${variantId}`);
    }

    await new Promise(res => setTimeout(res, 250)); // evite throttling
  }
  console.log("Batch upload terminé !");
})();
