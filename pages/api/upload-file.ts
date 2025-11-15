/**
 * PATCH : accepte aussi {buffer} dans le body, upload direct
 * sinon download via url HTTP(s)
 */
import type { NextApiRequest, NextApiResponse } from "next";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE}/admin/api/2023-07/graphql.json`;

async function uploadOne({url, filename, mimeType, buffer}: {url?: string, filename: string, mimeType: string, buffer?: Buffer}) {
  // 1. Staged upload (get S3 info)
  const fileSize = buffer ? buffer.length : 1;
  const stagedRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? ""},
    body: JSON.stringify({
      query: `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }
      `,
      variables: { input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST", fileSize }] }
    }),
  });
  const stagedJson = await stagedRes.json();
  if (!stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.length) return {ok: false, error:"staged error", stagedJson};
  const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];
  if (!target.resourceUrl) return {ok:false, error:"no resourceUrl", target};
  // 2. Source buffer/image
  let imageBuf: Buffer;
  if (buffer) {
    imageBuf = buffer;
  } else if (url) {
    const imageRes = await fetch(url);
    if (!imageRes.ok) return {ok:false, error:"source download failed"};
    imageBuf = Buffer.from(await imageRes.arrayBuffer());
  } else {
    return {ok:false, error:"missing buffer or url"};
  }
  // 3. S3 upload
  const uploadForm = new globalThis.FormData();
  for (const p of target.parameters) uploadForm.append(p.name, p.value);
  uploadForm.append("file", new Uint8Array(imageBuf), filename);
  const s3Res = await fetch(target.url, {method:"POST", body:uploadForm});
  if (!s3Res.ok) return {ok:false, error:"S3 upload error", details: await s3Res.text()};
  // 4. Shopify mutation
  const fileCreateRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? ""},
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
    }),
  });
  const fileCreateJson = await fileCreateRes.json();
  return {ok:true, result:fileCreateJson};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const images = req.body.images || [req.body];
    if (!Array.isArray(images) || !images[0]?.filename) return res.status(400).json({ok:false, error:"missing images array"});
    const results = [];
    for (const img of images) {
      // Support buffer : si img.buffer (expected base64), convert
      if (img.buffer) {
        const buffer = Buffer.isBuffer(img.buffer)
          ? img.buffer
          : Buffer.from(img.buffer, "base64");
        results.push(await uploadOne({...img, buffer}));
      } else {
        results.push(await uploadOne(img));
      }
    }
    res.status(200).json({ok:true, uploads: results});
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
}
