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

  let json;
  try {
    json = await res.json();
  } catch (err) {
    // Shopiy renvoie souvent une page HTML d'erreur (429, 403, etc.), pas du JSON
    const errText = await res.text();
    throw new Error(`Shopify fileCreate failed: Non-JSON response (${res.status}) | Body: ${errText}`);
  }
  return json;
}

const SHOP = "monshop.myshopify.com";        // <--- à adapter !
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const CSV_PATH = "./products.csv";            // <--- à adapter !

/** Détection automatique du séparateur du CSV (FR ; ou US ,) */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/** Récupère toutes les images uniques du CSV (colonne Image Src & Variant Image, exclut Shopify CDN) */
function getAllCsvImages(): { url: string, filename: string }[] {
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const delimiter = guessCsvDelimiter(csvText);
  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

  // Set pour ne pas doubler les images
  const urls = new Set<string>();
  for (const r of records) {
    const srcs = [
      r["Image Src"],        // image principale
      r["Variant Image"],    // image de variante
    ].filter(Boolean);

    for (const src of srcs) {
      // Filtrer Shopify CDN déjà hébergées, ou URLs invalides
      if (
        src && src.length > 6 &&
        !src.trim().startsWith("https://cdn.shopify.com") &&
        (src.startsWith("http://") || src.startsWith("https://"))
      ) {
        urls.add(src.trim());
      }
    }
  }
  // Mapping filename sans query params
  return Array.from(urls).map(url => {
    const filename = url.split("/").pop()?.split("?")[0] ?? "image.jpg";
    return { url, filename };
  });
}

/** Batch upload par mutation GraphQL, 200 images max par batch */
(async () => {
  const allCsvImages = getAllCsvImages();
  console.log(`Images uniques à uploader : ${allCsvImages.length}`);

  // Batchs de 200 images
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
      // PATCH: log le corps de réponse non JSON
      console.error("Erreur mutation fileCreate:", err);
      countFail += filesPayload.length;
      failedImages.push(...filesPayload.map(f => f.filename));
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
