import fs from "fs";
import path from "path";
import { Buffer } from "buffer";

/**
 * Shopify staged upload workflow:
 * 1. Request pre-signed S3 upload URL with stagedUploadsCreate
 * 2. POST file to S3 URL with provided fields
 * 3. Call fileCreate using S3 resourceUrl
 */
const SHOP = "monshop.myshopify.com"; // à adapter
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

/**
 * Step 1 : GraphQL stagedUploadsCreate
 */
async function getStagedUploadUrl(shop: string, token: string, filename: string, mimeType: string) {
  const res = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      query: `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              url
              resourceUrl
              parameters { name value }
            }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: [{
          filename,
          mimeType,
          resource: "FILE"
        }]
      }
    })
  });

  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`stagedUploadsCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (!json?.data?.stagedUploadsCreate?.stagedTargets?.[0]) {
    throw new Error("stagedUploadsCreate returned no stagedTargets: " + JSON.stringify(json));
  }
  return json.data.stagedUploadsCreate.stagedTargets[0];
}

/**
 * Step 2 : POST file to S3 URL with fields
 */
async function uploadToStagedUrl(stagedTarget: any, fileBuffer: Buffer, mimeType: string) {
  // Build FormData with all provided fields
  const formData = new FormData();
  for (const param of stagedTarget.parameters) {
    formData.append(param.name, param.value);
  }
  // field 'file' MUST be last
  formData.append('file', fileBuffer, { type: mimeType });

  const res = await fetch(stagedTarget.url, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`S3 upload failed: ${res.status} | ${errText}`);
  }
  return stagedTarget.resourceUrl;
}

/**
 * Step 3 : fileCreate with staged S3 URL
 */
async function fileCreateFromStaged(shop: string, token: string, resourceUrl: string, filename: string, mimeType: string) {
  const res = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { url fileStatus }
            userErrors { field message }
          }
        }
      `,
      variables: {
        files: [{
          originalSource: resourceUrl,
          originalFileName: filename,
          mimeType
        }]
      }
    })
  });
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`fileCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.fileCreate?.files?.[0]?.url) {
    return json.data.fileCreate.files[0].url;
  }
  if (json.data?.fileCreate?.userErrors?.length) {
    throw new Error('File create userErrors: ' + JSON.stringify(json.data.fileCreate.userErrors));
  }
  throw new Error(`fileCreate failed | Response: ${bodyText}`);
}

/**
 * High level utility to perform a staged upload for an image file
 */
export async function stagedUploadShopifyFile(shop: string, token: string, filePath: string) {
  const filename = path.basename(filePath);
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";

  // Step 1: stagedUploadsCreate
  const stagedTarget = await getStagedUploadUrl(shop, token, filename, mimeType);

  // Step 2: Upload to S3
  const fileBuffer = fs.readFileSync(filePath);
  const resourceUrl = await uploadToStagedUrl(stagedTarget, fileBuffer, mimeType);

  // Step 3: fileCreate using S3 URL
  return await fileCreateFromStaged(shop, token, resourceUrl, filename, mimeType);
}

/**
 * Example: batch upload local images from a directory
 */
async function batchUploadLocalImages(dir: string) {
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  for (const fname of files) {
    const filePath = path.resolve(dir, fname);
    try {
      const url = await stagedUploadShopifyFile(SHOP, TOKEN, filePath);
      console.log(`[UPLOAD] ${fname} → ${url}`);
    } catch (err) {
      console.error(`[FAIL] ${fname}: ${err}`);
    }
  }
}

// Example use: uncomment to batch upload all images from a local directory
// batchUploadLocalImages('./products_images');
