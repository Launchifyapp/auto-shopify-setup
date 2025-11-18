import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import fs from "fs";
import path from "path";

/**
 * Step 1: Get staged upload URL for product media (Shopify's S3/Google Cloud Storage)
 */
export async function getMediaStagedUpload(
  shop: string,
  token: string,
  filename: string,
  mimeType: string = "image/jpeg"
): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
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
      variables: { input: [
        { filename, mimeType, resource: "IMAGE" }
      ]}
    })
  });

  const data = await res.json() as any;
  const target = data?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("No staged upload target returned");
  return target;
}

/**
 * Step 2: Upload image to staged S3/Google Cloud Storage endpoint
 */
export async function uploadStagedMedia(
  stagedTarget: any,
  fileBuffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  const formData = new FormData();
  for (const param of stagedTarget.parameters) formData.append(param.name, param.value);
  formData.append("file", new File([fileBuffer], filename, {type: mimeType}));
  const encoder = new FormDataEncoder(formData);

  const res = await fetch(stagedTarget.url, {
    method: "POST",
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
 * Step 3: Register the uploaded file with Shopify "fileCreate" mutation
 */
export async function shopifyFileCreate(
  shop: string,
  token: string,
  resourceUrl: string,
  filename: string
): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id fileStatus preview { image { url } } }
            userErrors { field message }
          }
        }`,
      variables: { files: [{ originalSource: resourceUrl, alt: filename }] }
    })
  });
  const data = await res.json() as any;
  const fileNode = data.data?.fileCreate?.files?.[0];
  if (!fileNode) throw new Error("File create failed");
  return fileNode;
}

/**
 * Step 4: Poll for CDN URL (file available for product media)
 */
export async function pollShopifyFileCDNByFilename(
  shop: string,
  token: string,
  filename: string,
  intervalMs: number = 10000,
  maxTries: number = 40
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const url = await searchShopifyFileByFilename(shop, token, filename);
    if (url) return url;
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return null;
}

export async function searchShopifyFileByFilename(
  shop: string,
  token: string,
  filename: string
): Promise<string | null> {
  const res = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        query getFiles($filename: String!) {
          files(first: 10, query: $filename) {
            edges {
              node {
                ... on MediaImage { preview { image { url } } }
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
  return node?.preview?.image?.url ?? null;
}

/**
 * Step 5: Attach file to product as product media
 */
export async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { id status preview { image { url } } }
            mediaUserErrors { code message }
          }
        }
      `,
      variables: { productId, media: [
        {
          originalSource: imageUrl,
          mediaContentType: "IMAGE",
          alt: altText
        }
      ]}
    })
  });
  const data = await res.json() as any;
  return data.data?.productCreateMedia?.media?.[0];
}

/**
 * Step 6: Wrapper for previous pipeline compatibility – upload staged media from file path
 */
export async function stagedUploadShopifyFile(
  shop: string,
  token: string,
  filePath: string
): Promise<any> {
  const filename = path.basename(filePath);
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";
  const stagedTarget = await getMediaStagedUpload(shop, token, filename, mimeType);
  const fileBuffer = fs.readFileSync(filePath);
  const resourceUrl = await uploadStagedMedia(stagedTarget, fileBuffer, mimeType, filename);
  return await shopifyFileCreate(shop, token, resourceUrl, filename);
}
