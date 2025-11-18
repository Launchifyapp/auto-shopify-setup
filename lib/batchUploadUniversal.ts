import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import fs from "fs";
import path from "path";

const SHOP = process.env.SHOPIFY_STORE || "monshop.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";

// ⚡️ Poll CDN URL for a file by filename (with retries)
export async function pollShopifyFileCDNByFilename(
  shop: string,
  token: string,
  filename: string,
  intervalMs = 10000,
  maxTries = 40
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

// Search CDN image in Shopify Files by filename
export async function searchShopifyFileByFilename(
  shop: string,
  token: string,
  filename: string
): Promise<string | null> {
  console.log(`[Shopify] Fallback: search file by filename in Shopify Files: ${filename}`);
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
    console.log(`[Shopify] Files Fallback CDN url found for ${filename}: ${url}`);
    return url;
  }
  console.warn(`[Shopify] No CDN url found in Files by filename: ${filename}`);
  return null;
}

// Get S3 staged upload URL from Shopify (resource: IMAGE)
export async function getStagedUploadUrl(
  shop: string,
  token: string,
  filename: string,
  mimeType: string
) {
  console.log(`[Shopify] StagedUpload: get staged URL for ${filename} (${mimeType})`);
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
  try {
    json = JSON.parse(bodyText);
  } catch {
    console.error(`[Shopify] stagedUploadsCreate ERROR: ${bodyText}`);
    throw new Error(`stagedUploadsCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (!json?.data?.stagedUploadsCreate?.stagedTargets?.[0]) {
    throw new Error("stagedUploadsCreate returned no stagedTargets: " + JSON.stringify(json));
  }
  return json.data.stagedUploadsCreate.stagedTargets[0];
}

// Upload image buffer to staged S3/GCS URL via FormData multipart (critical signature step)
export async function uploadToStagedUrl(stagedTarget: any, fileBuffer: Buffer, mimeType: string, filename: string) {
  console.log(`[Shopify] S3: uploading ${filename} (${mimeType})`);
  console.log(`[Shopify] S3: stagedTarget.url = ${stagedTarget.url}`);
  console.log(`[Shopify] S3: stagedTarget.parameters =`, stagedTarget.parameters);

  // Must keep EXACT order and name of each parameter!
  const formData = new FormData();
  for (const param of stagedTarget.parameters) {
    formData.append(param.name, param.value);
  }
  // file must be last and named "file"
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

// Call GraphQL fileCreate after S3 upload and poll for CDN
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
      variables: { files: [{ originalSource: resourceUrl, alt: filename }] }
    }),
    duplex: "half"
  });
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    console.error(`[Shopify] fileCreate ERROR: ${bodyText}`);
    throw new Error(`fileCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.fileCreate?.userErrors?.length) {
    console.error('File create userErrors:', JSON.stringify(json.data.fileCreate.userErrors));
    throw new Error('File create userErrors: ' + JSON.stringify(json.data.fileCreate.userErrors));
  }
  // Poll for CDN url as soon as fileCreate succeeds (usually very quick after all batch uploads)
  return await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
}

// Entry point: staged upload for local file!
export async function stagedUploadShopifyFile(shop: string, token: string, filePath: string) {
  const filename = path.basename(filePath);
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";
  console.log(`[Shopify] stagedUploadShopifyFile: ${filePath}`);
  const stagedTarget = await getStagedUploadUrl(shop, token, filename, mimeType);
  const fileBuffer = fs.readFileSync(filePath);
  const resourceUrl = await uploadToStagedUrl(stagedTarget, fileBuffer, mimeType, filename);
  return await fileCreateFromStaged(shop, token, resourceUrl, filename, mimeType);
}

// Utilitaire batch upload d'un dossier local (attention: n'utilise pas pour les URLs du CSV)
export async function batchUploadLocalImages(dir: string) {
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  for (const fname of files) {
    const filePath = path.resolve(dir, fname);
    try {
      console.log(`[Batch] Processing file: ${fname}`);
      const cdnUrl = await stagedUploadShopifyFile(SHOP, TOKEN, filePath);
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
// Pour exécuter : batchUploadLocalImages('./products_images');
