import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import fs from "fs";
import path from "path";

const SHOP = process.env.SHOPIFY_STORE || "monshop.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";

// ⚡️ Exported polling function for CDN URL
export async function pollShopifyFileCDNByFilename(
  shop: string,
  token: string,
  filename: string,
  intervalMs = 10000, // attends 10s entre essais
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

/**
 * Shopify Files fallback: search CDN image by filename.
 * Direct lookup—no polling by MediaImage ID anymore!
 */
export async function searchShopifyFileByFilename(shop: string, token: string, filename: string): Promise<string | null> {
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

// Staged upload with resource: "IMAGE"
export async function getStagedUploadUrl(shop: string, token: string, filename: string, mimeType: string) {
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

export async function uploadToStagedUrl(stagedTarget: any, fileBuffer: Buffer, mimeType: string, filename: string) {
  // Blocs de debug
  console.log(`[Shopify] S3: uploading ${filename} (${mimeType})`);
  console.log(`[Shopify] S3: stagedTarget.url = ${stagedTarget.url}`);
  console.log(`[Shopify] S3: stagedTarget.parameters =`, stagedTarget.parameters);

  // FormData : tous les params donnés EXACTEMENT par Shopify
  const formData = new FormData();
  for (const param of stagedTarget.parameters) {
    formData.append(param.name, param.value);
  }
  // Le fichier, nom/mimeType/ordre correct
  formData.append('file', new File([fileBuffer], filename, { type: mimeType }));

  // Encodage multipart
  const encoder = new FormDataEncoder(formData);

  // POST multipart, headers du encoder
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
 * Upload image and get CDN url by polling Files fallback.
 */
export async function fileCreateFromStaged(shop: string, token: string, resourceUrl: string, filename: string, mimeType: string) {
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
  // Utilise le polling pour attendre le CDN URL
  return await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
}

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
