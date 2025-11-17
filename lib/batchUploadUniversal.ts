import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import fs from "fs";
import path from "path";

const SHOP = process.env.SHOPIFY_STORE || "monshop.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";

/**
 * Polls Shopify GraphQL API for a MediaImage preview URL until it's available or timeout.
 */
export async function pollShopifyImageCDNUrl(
  shop: string,
  token: string,
  mediaImageId: string,
  intervalMs = 3000,
  maxTries = 20
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        query: `
          query GetMediaImageCDN($id: ID!) {
            file(id: $id) {
              ... on MediaImage {
                id
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        `,
        variables: { id: mediaImageId }
      }),
      duplex: "half"
    });
    const bodyText = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`Shopify polling failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
    }
    const url = json?.data?.file?.preview?.image?.url ?? null;
    if (url) {
      return url;
    }
    if (attempt < maxTries) {
      await new Promise(res => setTimeout(res, intervalMs));
    }
  }
  return null;
}

/**
 * Shopify Files fallback: search CDN image by filename
 */
async function searchShopifyFileByFilename(shop: string, token: string, filename: string): Promise<string | null> {
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
    console.log(`[Shopify] Fallback CDN url from Files by filename (${filename}): ${url}`);
    return url;
  }
  return null;
}

// Staged upload with resource: "IMAGE"
async function getStagedUploadUrl(shop: string, token: string, filename: string, mimeType: string) {
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
    throw new Error(`stagedUploadsCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (!json?.data?.stagedUploadsCreate?.stagedTargets?.[0]) {
    throw new Error("stagedUploadsCreate returned no stagedTargets: " + JSON.stringify(json));
  }
  return json.data.stagedUploadsCreate.stagedTargets[0];
}

async function uploadToStagedUrl(stagedTarget: any, fileBuffer: Buffer, mimeType: string, filename: string) {
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
    throw new Error(`S3 upload failed: ${res.status} | ${errText}`);
  }
  return stagedTarget.resourceUrl;
}

/**
 * Patch: do NOT block if image is UPLOADED without preview (Shopify processes CDN asynchronously)
 * Now handles fallback by filename if polling doesn't provide the CDN.
 */
async function fileCreateFromStaged(shop: string, token: string, resourceUrl: string, filename: string, mimeType: string) {
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
    throw new Error(`fileCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  const fileObj = json?.data?.fileCreate?.files?.[0];
  const imageUrl = fileObj?.preview?.image?.url;
  if (imageUrl) return imageUrl;
  if (fileObj?.fileStatus === "UPLOADED" && !imageUrl) {
    console.warn(
      `[Shopify] Image uploaded (${filename}), fileStatus: UPLOADED but preview.image not ready yet. MediaImage ID: ${fileObj.id}`
    );
    return { status: "UPLOADED", id: fileObj.id, resourceUrl, previewReady: false };
  }
  if (json.data?.fileCreate?.userErrors?.length) throw new Error('File create userErrors: ' + JSON.stringify(json.data.fileCreate.userErrors));
  throw new Error(`fileCreate failed | Response: ${bodyText}`);
}

export async function stagedUploadShopifyFile(shop: string, token: string, filePath: string, pollCDN = true) {
  const filename = path.basename(filePath);
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";
  const stagedTarget = await getStagedUploadUrl(shop, token, filename, mimeType);
  const fileBuffer = fs.readFileSync(filePath);
  const resourceUrl = await uploadToStagedUrl(stagedTarget, fileBuffer, mimeType, filename);
  const urlOrObj = await fileCreateFromStaged(shop, token, resourceUrl, filename, mimeType);

  // ---- POLLING CDN + Fallback by filename ----
  if (typeof urlOrObj === 'string') {
    return urlOrObj;
  } else if (pollCDN && urlOrObj.status === "UPLOADED" && urlOrObj.id) {
    console.log(`[Shopify] Polling CDN for MediaImage ${urlOrObj.id}`);
    const cdnUrl = await pollShopifyImageCDNUrl(shop, token, urlOrObj.id);
    if (cdnUrl) {
      console.log(`[Shopify] CDN URL ready: ${cdnUrl}`);
      return cdnUrl;
    } else {
      console.warn(`[Shopify] CDN URL not ready after polling for ${urlOrObj.id}, searching Files by filename.`);
      // Fallback: search Files by filename for CDN URL
      const fallbackCdnUrl = await searchShopifyFileByFilename(shop, token, filename);
      if (fallbackCdnUrl) return fallbackCdnUrl;
      // On retourne l'objet et la resourceUrl, le frontend peut re-poller si besoin
      return urlOrObj;
    }
  } else {
    return urlOrObj;
  }
}

// Batch upload utility
export async function batchUploadLocalImages(dir: string) {
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  for (const fname of files) {
    const filePath = path.resolve(dir, fname);
    try {
      const urlOrObj = await stagedUploadShopifyFile(SHOP, TOKEN, filePath, true);
      if (typeof urlOrObj === 'string') {
        console.log(`[UPLOAD] ${fname} → ${urlOrObj}`);
      } else {
        if (urlOrObj.previewReady === false) {
          console.log(`[UPLOAD] ${fname} UPLOADED (preview pending), MediaImage ID: ${urlOrObj.id}. Resource URL: ${urlOrObj.resourceUrl}`);
        } else {
          console.log(`[UPLOAD] ${fname} → (result)`, urlOrObj);
        }
      }
    } catch (err) {
      console.error(`[FAIL] ${fname}: ${err}`);
    }
  }
}
// Pour exécuter : batchUploadLocalImages('./products_images');
