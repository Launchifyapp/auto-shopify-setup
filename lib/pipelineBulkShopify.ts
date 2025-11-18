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


pages/api/upload-file.ts
export const config = { runtime: 'nodejs' };
import type { NextApiRequest, NextApiResponse } from "next";
import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import { Buffer } from "buffer";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`;

/** Utilitaire pour ignorer les URLs invalides (nan, null, undefined, vides) */
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

/**
 * Direct fallback: lookup CDN image in Shopify Files by filename (no polling, for API usage)
 */
async function searchShopifyFileByFilename(shop: string, token: string, filename: string): Promise<string | null> {
  console.log(`[Shopify] [API] Fallback: search file by filename in Shopify Files: ${filename}`);
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
    }),
    duplex: "half"
  });
  const body = await res.json() as any;
  const node = body?.data?.files?.edges?.[0]?.node;
  const url = node?.preview?.image?.url ?? null;
  if (url) {
    console.log(`[Shopify] [API] Fallback CDN url from Files by filename (${filename}): ${url}`);
    return url;
  }
  console.warn(`[Shopify] [API] No CDN url found in Files by filename: ${filename}`);
  return null;
}

/**
 * Upload image: staged upload S3 + create file, get CDN direct from Files fallback (no polling, stateless API)
 */
async function uploadOne({ url, filename, mimeType }: { url: string; filename: string; mimeType: string }) {
  url = normalizeImageUrl(url);

  // IGNORE les valeurs invalides :
  if (!validImageUrl(url) || !validImageUrl(filename)) {
    console.warn(`[Upload] Skipping invalid image url or filename. url="${url}" filename="${filename}"`);
    return { ok: false, error: "Invalid image url or filename", url, filename };
  }

  console.log(`[Upload] API upload-file: filename=${filename}, mimeType=${mimeType}, url=${url}`);

  // 1. Step: Staged upload request
  const stagedRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
    },
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
        input: [
          {
            filename,
            mimeType,
            resource: "IMAGE",
            httpMethod: "POST",
            fileSize: "1"
          }
        ]
      }
    }),
    duplex: "half"
  });
  const stagedJson = await stagedRes.json() as any;
  console.log("[Upload] stagedUploadsCreate return:", JSON.stringify(stagedJson));
  if (
    !stagedJson ||
    !stagedJson.data ||
    !stagedJson.data.stagedUploadsCreate ||
    !Array.isArray(stagedJson.data.stagedUploadsCreate.stagedTargets) ||
    !stagedJson.data.stagedUploadsCreate.stagedTargets.length
  ) {
    console.error("[Upload] stagedUploadsCreate ERROR:", stagedJson);
    return { ok: false, error: "staged error", stagedJson };
  }

  const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];
  if (!target || !target.resourceUrl) {
    console.error("[Upload] stagedUploadsCreate NO resourceUrl", target);
    return { ok: false, error: "no resourceUrl", target };
  }

  // 2. Download image from provided HTTP url
  console.log("[Upload] Downloading image from url:", url);
  const imageRes = await fetch(url);
  if (!imageRes.ok) {
    console.error(`[Upload] Source download failed (${imageRes.status})`);
    return { ok: false, error: "source download failed", status: imageRes.status };
  }
  const imageBuf = Buffer.from(await imageRes.arrayBuffer());

  // 3. Send to S3
  console.log("[Upload] Uploading image to S3.");
  const uploadForm = new FormData();
  for (const p of target.parameters) uploadForm.append(p.name, p.value);
  uploadForm.append("file", new File([imageBuf], filename, { type: mimeType }));

  const encoder = new FormDataEncoder(uploadForm);
  const s3Res = await fetch(target.url, {
    method: "POST",
    body: encoder.encode(),
    headers: encoder.headers,
    duplex: "half"
  });
  const s3Text = await s3Res.text();
  console.log("[Upload] S3 upload response:", s3Res.status, s3Text);
  if (!s3Res.ok) {
    console.error(`[Upload] S3 upload error: ${s3Res.status} | ${s3Text}`);
    return { ok: false, error: "S3 upload error", details: s3Text };
  }

  // 4. Shopify mutation to create file from resourceUrl
  console.log("[Upload] Creating Shopify file from staged resourceUrl");
  const fileCreateRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
    },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              alt
              createdAt
              fileStatus
              preview {
                image {
                  url
                }
              }
            }
            userErrors { field message }
          }
        }
      `,
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            alt: filename,
          }
        ]
      }
    }),
    duplex: "half"
  });
  const fileCreateJson = await fileCreateRes.json() as any;
  console.log("[Upload] fileCreate return:", JSON.stringify(fileCreateJson));
  if (fileCreateJson.data?.fileCreate?.userErrors?.length) {
    console.error("[Upload] fileCreate userErrors:", JSON.stringify(fileCreateJson.data.fileCreate.userErrors));
    return { ok: false, error: "fileCreate userErrors", details: fileCreateJson.data.fileCreate.userErrors };
  }

  // Direct fallback: Files by filename (no polling, API stateless)
  const imageUrl = await searchShopifyFileByFilename(SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, filename);

  console.log(`[Upload] End upload filename=${filename}, imageUrl=${imageUrl}`);
  return { ok: true, result: fileCreateJson, imageUrl };
}

/**
 * API route for single image uploads (for admin use, not pipeline). Bulk orchestration uses lib/pipelineBulkShopify.ts!
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("[Shopify] upload-file handler called", req.method, req.body);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    // Accept either 1 object or {images: array} in req.body
    const images = req.body.images || [req.body];
    if (!Array.isArray(images) || !images[0]?.url)
      return res.status(400).json({ ok: false, error: "missing images array" });

    const results = [];
    for (const img of images) {
      console.log(`[Shopify] processing image:`, img);
      // Vérifie d'abord la validité AVANT uploadOne
      if (!validImageUrl(img.url) || !validImageUrl(img.filename)) {
        results.push({ ok: false, error: "Invalid image url or filename", url: img.url, filename: img.filename });
        continue;
      }
      results.push(await uploadOne(img));
    }
    console.log("[Shopify] upload results:", JSON.stringify(results));
    res.status(200).json({ ok: true, uploads: results });
  } catch (error: any) {
    console.error("API 500 error:", error);
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
}
