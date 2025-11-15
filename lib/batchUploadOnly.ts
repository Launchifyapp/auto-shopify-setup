import fs from "fs";
import path from "path";
import { fileTypeFromBuffer } from "file-type";

// REGLAGE
const SHOP_URL = "YOUR_SHOP_NAME.myshopify.com"; // ← à personnaliser !
const TOKEN = "YOUR_API_TOKEN"; // ← à personnaliser !
const API_VERSION = "2023-10";

const IMAGES_DIR = "./public/products_images/";
const SPECIAL_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image4.jpg",
  "./public/image4.webp"
];

// Fonction d'upload "staged", compatible Next.js/serverless
async function uploadImageToShopify(filePath: string, filename: string) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length === 0) throw new Error(`Image vide: ${filename}`);
  if (buffer.length > 20 * 1024 * 1024) throw new Error(`Image trop volumineuse (>20Mo): ${filename}`);

  const type = await fileTypeFromBuffer(buffer);
  const mimeType = type?.mime || (
    filename.endsWith(".png") ? "image/png"
      : filename.endsWith(".webp") ? "image/webp"
      : "image/jpeg"
  );

  // Staged upload
  const stagedRes = await fetch(`https://${SHOP_URL}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({
      query: `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST", fileSize: buffer.length }]
      }
    })
  });
  const stagedJson = await stagedRes.json();
  if (!stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.length) throw new Error("staged error " + JSON.stringify(stagedJson));
  const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];
  if (!target.resourceUrl) throw new Error("no resourceUrl for " + filename);

  // S3 upload
  const formData = new FormData();
  for (const p of target.parameters) formData.append(p.name, p.value);
  formData.append("file", new Blob([buffer], {type: mimeType}), filename);
  const s3Res = await fetch(target.url, {method:"POST", body:formData});
  if (!s3Res.ok) throw new Error("S3 upload error " + await s3Res.text());

  // Shopify Files registration
  const fileCreateRes = await fetch(`https://${SHOP_URL}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id alt createdAt fileStatus preview { image { url } } }
            userErrors { field message }
          }
        }
      `,
      variables: { files: [{ originalSource: target.resourceUrl, alt: filename }] }
    })
  });
  const fileCreateJson = await fileCreateRes.json();

  if (fileCreateJson.data?.fileCreate?.userErrors?.length) {
    throw new Error("Shopify fileCreate userErrors: " + JSON.stringify(fileCreateJson.data.fileCreate.userErrors));
  }
  return fileCreateJson.data.fileCreate.files?.[0]?.preview?.image?.url || "[NO CDN URL]";
}

// Batch upload principal
(async () => {
  // Batch images du dossier products_images
  const files = fs.readdirSync(IMAGES_DIR).filter(f =>
    /\.(jpg|jpeg|png|webp)$/i.test(f)
  );
  for (const filename of files) {
    const filePath = path.join(IMAGES_DIR, filename);
    try {
      const cdnUrl = await uploadImageToShopify(filePath, filename);
      console.log(`[PRODUCT IMAGE] ${filename} uploaded → ${cdnUrl}`);
      // Ici, si mapping CSV disponible, on peut rattacher via productCreateMedia/productVariantUpdate
    } catch (err) {
      console.error(`[PRODUCT IMAGE ERROR] ${filename}`, err);
    }
  }

  // Batch upload des images “spéciales” NON rattachées à produit
  for (const imgPath of SPECIAL_IMAGES) {
    const filename = path.basename(imgPath);
    if (!fs.existsSync(imgPath)) {
      console.warn(`[SPECIAL IMAGE] ${filename} not found!`);
      continue;
    }
    try {
      const cdnUrl = await uploadImageToShopify(imgPath, filename);
      console.log(`[SPECIAL IMAGE] ${filename} uploaded (not attached) → ${cdnUrl}`);
      // On n'attache pas ces images à des produits/variants !
    } catch (err) {
      console.error(`[SPECIAL IMAGE ERROR] ${filename}`, err);
    }
  }
  console.log("Batch upload TERMINÉ!");
})();
