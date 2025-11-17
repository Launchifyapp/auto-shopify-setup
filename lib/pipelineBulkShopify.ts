import { parse } from "csv-parse/sync";
import { Buffer } from "buffer";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile } from "./batchUploadUniversal"; // Doit utiliser le fallback direct, pas de polling ID
import { fetch } from "undici";

// Utilitaire pour CSV ; ou ,
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

// Vérifie la validité d'une URL d'image (ignore "nan", "null", "undefined", vide)
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const val = url.trim().toLowerCase();
  return !!val && val !== "nan" && val !== "null" && val !== "undefined";
}

// Fallback polling sur Files/filename directement (pour la CDN)
async function pollShopifyFileCDNByFilename(
  shop: string,
  token: string,
  filename: string,
  intervalMs = 10000, // MODIF: attendre 10s entre essais, au lieu de 3s
  maxTries = 2      // MODIF: jusqu'à 40 essais, au lieu de 20
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    console.log(`[Shopify] Files CDN polling try=${attempt}/${maxTries} for filename=${filename}`);
    const url = await searchShopifyFileByFilename(shop, token, filename);
    if (url) {
      console.log(`[Shopify] Files polling CDN url found for ${filename}: ${url}`);
      return url;
    }
    if (attempt < maxTries) {
      await new Promise(res => setTimeout(res, intervalMs));
    }
  }
  console.warn(`[Shopify] Files CDN polling finished: STILL not found for ${filename} after ${maxTries} tries`);
  return null;
}

// Requête GraphQL pour chercher les CDN Shopify Files par filename
async function searchShopifyFileByFilename(
  shop: string,
  token: string,
  filename: string
): Promise<string | null> {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        query getFiles($filename: String!) {
          files(first: 10, query: $filename) {
            edges {
              node {
                ... on MediaImage {
                  preview { image { url } }
                }
              }
            }
          }
        }
      `,
      variables: { filename }
    })
  });
  const body = await res.json() as any;
  const node = body?.data?.files?.edges?.[0]?.node;
  const url = node?.preview?.image?.url ?? null;
  if (url) {
    console.log(`[Shopify] Files CDN url from Files by filename (${filename}): ${url}`);
    return url;
  }
  return null;
}

// Attachement d'image à un produit Shopify
async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
) {
  console.log(`[Shopify] Attaching image to productId=${productId}: imageUrl=${imageUrl ?? "null"}, altText="${altText}"`);
  const media = [
    {
      originalSource: imageUrl,
      mediaContentType: "IMAGE",
      alt: altText,
    },
  ];
  const res = await fetch(
    `https://${shop}/admin/api/2025-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              id
              status
              preview {
                image {
                  url
                }
              }
              mediaErrors {
                code
                message
              }
            }
            mediaUserErrors {
              code
              message
            }
          }
        }
        `,
        variables: { productId, media },
      }),
    }
  );
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`productCreateMedia failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  const mediaObj = json?.data?.productCreateMedia?.media?.[0];
  console.log(`[Shopify] productCreateMedia response: status=${mediaObj?.status}, url=${mediaObj?.preview?.image?.url ?? "null"}, mediaErrors=${JSON.stringify(mediaObj?.mediaErrors)}`);
  if (json.data?.productCreateMedia?.mediaUserErrors?.length) {
    console.error(`[Shopify] mediaUserErrors:`, JSON.stringify(json.data.productCreateMedia.mediaUserErrors));
  }
  return json;
}

// Attachement d'image à une variante Shopify
async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
) {
  console.log(`[Shopify] Attaching image to variantId=${variantId}: imageUrl=${imageUrl ?? "null"}, altText="${altText}"`);
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
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
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`productVariantUpdate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.productVariantUpdate?.userErrors?.length) {
    console.error("Erreur productVariantUpdate:", JSON.stringify(json.data.productVariantUpdate.userErrors));
  }
  return json;
}

/**
 * Pipeline principal: BULK UPLOAD puis BULK LINK des images du CSV vers Shopify
 */
export async function pipelineBulkShopify({ shop, token }: { shop: string; token: string }) {
  // 1. Lire CSV
  console.log("[Shopify] pipelineBulkShopify: Fetch CSV...");
  const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  const delimiter = guessCsvDelimiter(csvText);
  console.log(`[Shopify] pipeline: parsed delimiter=${delimiter}`);

  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

  // Structure intermédiaire à traiter par batch
  const uploadQueue: any[] = [];
  const linkQueue: any[] = [];

  // 2. Construction queue, EXTRACT INFOS & filenames/images du CSV
  for (const row of records) {
    // Pour image produit
    if (validImageUrl(row["Image Src"])) {
      uploadQueue.push({
        src: row["Image Src"],
        filename: (row["Image Src"].split('/').pop() || "image.jpg").trim(),
        altText: row["Image Alt Text"] || "",
        handle: row.Handle,
        type: "product",
        productId: null, // à remplir plus tard
      });
    }
    // Pour image de variante
    if (validImageUrl(row["Variant Image"])) {
      uploadQueue.push({
        src: row["Variant Image"],
        filename: (row["Variant Image"].split('/').pop() || "variant.jpg").trim(),
        altText: row["Image Alt Text"] || "",
        handle: row.Handle,
        type: "variant",
        variantKey: [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]].filter(Boolean).join(":"),
        variantId: null, // à remplir plus tard
      });
    }
  }

  // 3. BULK UPLOAD toutes les images (produits et variantes)
  for (const file of uploadQueue) {
    try {
      if (file.src.startsWith("https://cdn.shopify.com")) {
        console.log(`[Shopify] SKIP already CDN: ${file.filename}`);
        continue;
      }
      // Upload image file
      await stagedUploadShopifyFile(shop, token, file.src); // pas besoin de CDN ici
      console.log(`[Shopify] UPLOADED filename=${file.filename}`);
    } catch (err) {
      console.error(`[Shopify] FAIL upload for ${file.filename}:`, err);
    }
  }

  // 4. Création des produits/variants en BATCH (à intégrer à ton workflow: productId/variantId)
  // Adapté à ton workflow existant!

  // 5. BULK LINK: pour chaque image, polling + attachement
  for (const img of uploadQueue) {
    try {
      const cdnUrl = await pollShopifyFileCDNByFilename(shop, token, img.filename, 10000, 40); // MODIF: attendre + longtemps pour le CDN
      if (!cdnUrl) {
        console.warn(`[Shopify] NOT FOUND: CDN for filename=${img.filename}`);
        continue;
      }
      if (img.type === "product" && img.productId) {
        await attachImageToProduct(shop, token, img.productId, cdnUrl, img.altText);
        console.log(`[Shopify] ✓ Linked Product image ${img.filename} to ID ${img.productId}`);
      }
      if (img.type === "variant" && img.variantId) {
        await attachImageToVariant(shop, token, img.variantId, cdnUrl, img.altText);
        console.log(`[Shopify] ✓ Linked Variant image ${img.filename} to ID ${img.variantId}`);
      }
    } catch (err) {
      console.error(`[Shopify] FAIL link for ${img.filename}:`, err);
    }
  }
  console.log("[Shopify] pipelineBulkShopify: DONE.");
}
