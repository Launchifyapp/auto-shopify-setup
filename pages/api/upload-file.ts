export const config = {runtime: "nodejs"};
import type { NextApiRequest, NextApiResponse } from "next";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE}/admin/api/2023-07/graphql.json`;

async function uploadOne({url, filename, mimeType}: {url: string, filename: string, mimeType: string}) {
  // 1. Staged upload
  const stagedRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? "",
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
      variables: { input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST", fileSize: "1" }] },
    }),
  });
  const stagedJson = await stagedRes.json();
  if (!stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.length) return {ok: false, error:"staged error", stagedJson};
  const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];
  if (!target.resourceUrl) return {ok:false, error:"no resourceUrl", target};
  // 2. Download image as ArrayBuffer from HTTP(S) only (no file:// allowed!)
  const imageRes = await fetch(url);
  if (!imageRes.ok) return {ok:false, error:"source download failed"};
  const imageBuf = Buffer.from(await imageRes.arrayBuffer());
  // 3. FormData natif: utilise Blob en Node 18+, ou patch undici/formdata-node si besoin
  // Node.js (Next API route) doit utiliser Blob pour FormData. Patch ici :
  const uploadForm = new globalThis.FormData();
  for (const p of target.parameters) uploadForm.append(p.name, p.value);
  const blob = new Blob([imageBuf], {type: mimeType});
  uploadForm.append("file", blob, filename);
  // 4. Upload to S3
  const s3Res = await fetch(target.url, {method:"POST", body:uploadForm});
  if (!s3Res.ok) return {ok:false, error:"S3 upload error", details: await s3Res.text()};
  // 5. Mutation Shopify
  const fileCreateRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? "",
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
      variables: { files: [{ originalSource: target.resourceUrl, alt: filename }] },
    }),
  });
  const fileCreateJson = await fileCreateRes.json();
  return {ok:true, result:fileCreateJson};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    // Accept either 1 object or {images: array} in req.body
    const images = req.body.images || [req.body];
    if (!Array.isArray(images) || !images[0]?.url) return res.status(400).json({ok:false, error:"missing images array"});
    const results = [];
    for (const img of images) {
      // Optionally: await Promise.all for concurrent uploads!
      results.push(await uploadOne(img));
    }
    res.status(200).json({ok:true, uploads: results});
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
}
