export const config = { runtime: 'nodejs' };
import type { NextApiRequest, NextApiResponse } from "next";
import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import { Buffer } from "buffer";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`;

function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

async function uploadOne({ url, filename, mimeType }: { url: string; filename: string; mimeType: string }) {
  url = normalizeImageUrl(url);

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
  });
 const stagedJson = await stagedRes.json() as any;
console.log("stagedUploadsCreate:", JSON.stringify(stagedJson));
if (
  !stagedJson ||
  !stagedJson.data ||
  !stagedJson.data.stagedUploadsCreate ||
  !Array.isArray(stagedJson.data.stagedUploadsCreate.stagedTargets) ||
  !stagedJson.data.stagedUploadsCreate.stagedTargets.length
) {
  return { ok: false, error: "staged error", stagedJson };
}

const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];
if (!target || !target.resourceUrl) {
  return { ok: false, error: "no resourceUrl", target };
}

  // 2. Step: Download image from provided HTTP url
  const imageRes = await fetch(url);
  if (!imageRes.ok) return { ok: false, error: "source download failed", status: imageRes.status };
  const imageBuf = Buffer.from(await imageRes.arrayBuffer());

  // 3. Step: Send to S3 (using formdata-node + form-data-encoder + undici)
  const uploadForm = new FormData();
  for (const p of target.parameters) uploadForm.append(p.name, p.value);
  uploadForm.append("file", new File([imageBuf], filename, { type: mimeType }));

  const encoder = new FormDataEncoder(uploadForm);
  const s3Res = await fetch(target.url, {
    method: "POST",
    body: encoder.encode(),
    headers: encoder.headers
  });
  const s3Text = await s3Res.text();
  console.log("S3 upload response:", s3Res.status, s3Text);
  if (!s3Res.ok)
    return { ok: false, error: "S3 upload error", details: s3Text };

  // 4. Step: Shopify mutation to create file from resourceUrl
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
            files { id alt createdAt fileStatus preview { image { url } } }
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
  });
  const fileCreateJson = await fileCreateRes.json();
  console.log("fileCreate:", JSON.stringify(fileCreateJson));
  return { ok: true, result: fileCreateJson };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    // Accept either 1 object or {images: array} in req.body
    const images = req.body.images || [req.body];
    if (!Array.isArray(images) || !images[0]?.url)
      return res.status(400).json({ ok: false, error: "missing images array" });
    const results = [];
    for (const img of images) {
      results.push(await uploadOne(img));
    }
    res.status(200).json({ ok: true, uploads: results });
  } catch (error: any) {
    console.error("API 500 error:", error);
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
}
