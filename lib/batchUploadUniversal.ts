import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import fs from "fs";
import path from "path";

/**
 * Polls Shopify Files CDN for the uploaded image URL by filename.
 */
export async function pollShopifyFileCDNByFilename(
  shop: string,
  token: string,
  filename: string,
  intervalMs = 10000, // Wait 10s between tries
  maxTries = 2 // Up to 40 tries total
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    console.log(`[Shopify] Files CDN polling try=${attempt}/${maxTries} for filename=${filename}`);
    const url = await searchShopifyFileByFilename(shop, token, filename);
    if (url) return url;
    if (attempt < maxTries) await new Promise(res => setTimeout(res, intervalMs));
  }
  console.warn(`[Shopify] Files CDN polling finished: STILL not found for ${filename} after ${maxTries} tries`);
  return null;
}

/**
 * Searches Shopify Files by filename.
 */
export async function searchShopifyFileByFilename(
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
    }),
    duplex: "half"
  });
  const body = await res.json() as any;
  const node = body?.data?.files?.edges?.[0]?.node;
  const url = node?.preview?.image?.url ?? null;
  if (url) {
    console.log(`[Shopify] Files CDN url found for ${filename}: ${url}`);
    return url;
  }
  console.warn(`[Shopify] No CDN url found for filename: ${filename}`);
  return null;
}

/**
 * Gets the staged upload target from Shopify API.
 */
export async function getStagedUploadUrl(
  shop: string,
  token: string,
  filename: string,
  mimeType: string
) {
  console.log(`[Shopify] get staged URL for ${filename} (${mimeType})`);
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
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
      variables: { input: [{ filename, mimeType, resource: "IMAGE" }] }
    }),
    duplex: "half"
  });

  const bodyText = await res.text();
  let json: any = null;
  try { json = JSON.parse(bodyText); } catch {
    console.error(`[Shopify] stagedUploadsCreate ERROR: ${bodyText}`);
    throw new Error(`stagedUploadsCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (!json?.data?.stagedUploadsCreate?.stagedTargets?.[0]) {
    throw new Error("stagedUploadsCreate returned no stagedTargets: " + JSON.stringify(json));
  }
  return json.data.stagedUploadsCreate.stagedTargets[0];
}

/**
 * Uploads a buffer to the staged upload S3 target.
 */
export async function uploadToStagedUrl(
  stagedTarget: any,
  fileBuffer: Buffer,
  mimeType: string,
  filename: string
) {
  console.log(`[Shopify] S3: uploading ${filename} (${mimeType})`);
  // --- DEBUG ---
  console.log("DEBUG stagedTarget.url:", stagedTarget.url);
  console.log("DEBUG stagedTarget.parameters:", stagedTarget.parameters);
  console.log("DEBUG buffer length:", fileBuffer.length);

  const formData = new FormData();
  for (const param of stagedTarget.parameters) formData.append(param.name, param.value);
  formData.append('file', new File([fileBuffer], filename, { type: mimeType }));

  const encoder = new FormDataEncoder(formData);
  const res = await fetch(stagedTarget.url, {
    method: 'POST',
    body: encoder.encode(),
    headers: encoder.headers,
    duplex: "half"
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Shopify] S3 upload failed for ${filename}: ${errText}`);
    throw new Error(`S3 upload failed: ${res.status} | ${errText}`);
  }
  return stagedTarget.resourceUrl;
}

/**
 * Finalizes a file upload on Shopify by creating the file media record.
 */
export async function fileCreateFromStaged(
  shop: string,
  token: string,
  resourceUrl: string,
  filename: string,
  mimeType: string
) {
  console.log(`[Shopify] fileCreateFromStaged: ${filename}`);
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              fileStatus
              preview { image { url } }
            }
            userErrors { field message }
          }
        }
      `,
      variables: { files: [{ originalSource: resourceUrl, alt: filename }] }
    }),
    duplex: "half"
  });
  const bodyText = await res.text();
  let json: any = null;
  try { json = JSON.parse(bodyText); } catch {
    console.error(`[Shopify] fileCreate ERROR: ${bodyText}`);
    throw new Error(`fileCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.fileCreate?.userErrors?.length) {
    console.error('File create userErrors:', JSON.stringify(json.data.fileCreate.userErrors));
    throw new Error('File create userErrors: ' + JSON.stringify(json.data.fileCreate.userErrors));
  }
  return await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
}

/**
 * Universal upload: accepts Buffer or local file path!
 */
export async function stagedUploadShopifyFile(
  shop: string,
  token: string,
  file: Buffer | string,
  filename?: string,
  mimeType?: string
): Promise<string | null> {
  let fileBuffer: Buffer;
  let realFilename: string;
  let realMimeType: string;

  if (typeof file === "string") {
    // filePath local
    realFilename = path.basename(file);
    fileBuffer = fs.readFileSync(file);
    realMimeType =
      realFilename.endsWith('.png') ? "image/png"
      : realFilename.endsWith('.webp') ? "image/webp"
      : "image/jpeg";
  } else {
    // Buffer HTTP
    if (!filename) throw new Error("filename required for Buffer upload");
    if (!mimeType) throw new Error("mimeType required for Buffer upload");
    realFilename = filename;
    realMimeType = mimeType;
    fileBuffer = file;
  }
  console.log(`[Shopify] stagedUploadShopifyFile: ${realFilename} (${realMimeType})`);

  // 1. Get staged upload target from Shopify
  const stagedTarget = await getStagedUploadUrl(shop, token, realFilename, realMimeType);

  // 2. Assemble form-data and POST
  const resourceUrl = await uploadToStagedUrl(stagedTarget, fileBuffer, realMimeType, realFilename);

  // 3. Create file in Shopify and poll CDN url
  return await fileCreateFromStaged(shop, token, resourceUrl, realFilename, realMimeType);
}

/**
 * Batch upload utility, requires explicit shop/token as args.
 */
export async function batchUploadLocalImages(
  shop: string,
  token: string,
  dir: string
) {
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  for (const fname of files) {
    const filePath = path.resolve(dir, fname);
    try {
      console.log(`[Batch] Processing file: ${fname}`);
      const cdnUrl = await stagedUploadShopifyFile(shop, token, filePath);
      if (cdnUrl) {
        console.log(`[UPLOAD] ${fname} → ${cdnUrl}`);
      } else {
        console.warn(`[UPLOAD] ${fname} → No CDN url found`);
      }
    } catch (err) {
      console.error(`[FAIL] ${fname}: ${err}`);
    }
  }
}
// Ex: await batchUploadLocalImages('YOUR_SHOP.myshopify.com','YOUR_ADMIN_TOKEN','./products_images');
