import fs from "fs";
import path from "path";

// Shopify GraphQL Admin API upload util
async function shopifyGraphQL(shop: string, token: string, query: string, variables: any = {}) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image3.jpg",
  "./public/image4.webp"
];
const PUBLIC_BASE = "https://auto-shopify-setup.vercel.app";

const SHOP = "monshop.myshopify.com";
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
  const allFiles = Array.from(new Set([...imageFiles, ...extraFiles]));

  // Prépare le payload FileCreateInput[]
  const filesPayload = allFiles.map(filePath => {
    const filename = path.basename(filePath);
    let url;
    if (filePath.startsWith(IMAGES_DIR)) {
      url = `${PUBLIC_BASE}/products_images/${filename}`;
    } else {
      url = `${PUBLIC_BASE}/${filename}`;
    }
    return {
      alt: filename,
      filename,
      contentType: "IMAGE",
      originalSource: url
    };
  });

  // On batch tout dans une mutation GraphQL fileCreate
  const mutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          createdAt
          ... on MediaImage {
            url
            image { width height }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    files: filesPayload
  };

  let results;
  try {
    results = await shopifyGraphQL(SHOP, TOKEN, mutation, variables);
  } catch (err) {
    console.error("Erreur mutation fileCreate:", err);
    process.exit(1);
  }

  let countSuccess = 0, countFail = 0, failedFiles: string[] = [];
  if (
    results &&
    results.data &&
    results.data.fileCreate &&
    Array.isArray(results.data.fileCreate.files)
  ) {
    for (const [idx, file] of results.data.fileCreate.files.entries()) {
      if (file.fileStatus === "READY" || file.url) {
        console.log(`[UPLOAD SUCCESS] ${file.alt}: ${file.url || file.id}`);
        countSuccess++;
      } else {
        console.error(`[UPLOAD ERROR] ${file.alt}: Status=${file.fileStatus}`);
        countFail++;
        failedFiles.push(file.alt);
      }
    }
  }

  // Afficher les erreurs field/message
  if (
    results &&
    results.data &&
    results.data.fileCreate &&
    Array.isArray(results.data.fileCreate.userErrors)
  ) {
    for (const ue of results.data.fileCreate.userErrors) {
      console.error(`[USER ERROR] ${ue.field?.join(".")}: ${ue.message}`);
    }
  }

  console.log(`✔️ ${countSuccess} images uploadées. ❌ ${countFail} erreurs.`);
  if (countFail) console.log("Images en erreur:", failedFiles);
})();
