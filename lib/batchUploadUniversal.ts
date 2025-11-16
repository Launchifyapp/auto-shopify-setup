import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

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

const SHOP = "monshop.myshopify.com"; // à adapter
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const CSV_PATH = "./products.csv"; // à adapter si besoin

/**
 * Récupère toutes les images uniques du CSV (présentes dans la colonne Image Src, exclut les Shopify CDN)
 */
function getAllCsvImages(): { url: string, filename: string }[] {
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });
  
  // Set pour ne pas doubler les images
  const urls = new Set<string>();
  for (const r of records) {
    const src = r["Image Src"];
    if (src && src.length > 6 && !src.startsWith("https://cdn.shopify.com")) {
      urls.add(src);
    }
    // tu peux aussi inclure les Variant Image si tu veux
    if (r["Variant Image"] && r["Variant Image"].length > 6 && !r["Variant Image"].startsWith("https://cdn.shopify.com")) {
      urls.add(r["Variant Image"]);
    }
  }
  return Array.from(urls).map(url => {
    const filename = url.split("/").pop()?.split("?")[0] ?? "image.jpg";
    return { url, filename };
  });
}

/**
 * On batch upload en mutation GraphQL par paquets de 200
 */
(async () => {
  const allCsvImages = getAllCsvImages();
  console.log(`Images uniques à uploader : ${allCsvImages.length}`);

  // Découpe en batches de 200
  const chunkSize = 200;
  let countSuccess = 0, countFail = 0;
  let failedImages: string[] = [];

  for (let i = 0; i < allCsvImages.length; i += chunkSize) {
    const chunk = allCsvImages.slice(i, i + chunkSize);
    const filesPayload = chunk.map(({ url, filename }) => ({
      alt: filename,
      filename,
      contentType: "IMAGE",
      originalSource: url
    }));

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
    const variables = { files: filesPayload };
    let results;
    try {
      results = await shopifyGraphQL(SHOP, TOKEN, mutation, variables);
    } catch (err) {
      console.error("Erreur mutation fileCreate:", err);
      continue;
    }
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
          failedImages.push(file.alt);
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

    await new Promise(r => setTimeout(r, 500)); // anti-throttle Shopify
  }
  console.log(`✔️ ${countSuccess} images uploadées. ❌ ${countFail} erreurs.`);
  if (countFail) console.log("Images en erreur:", failedImages);
})();
