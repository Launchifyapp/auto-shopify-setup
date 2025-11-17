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
