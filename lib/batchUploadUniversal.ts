import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";

// 1. Get staged upload URL for product media
export async function getMediaStagedUpload(shop, token, filename, mimeType="image/jpeg") {
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

  const data = await res.json();
  const target = data?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("No staged upload target returned");
  return target;
}

// 2. Upload image to Google Cloud endpoint
export async function uploadStagedMedia(stagedTarget, fileBuffer, mimeType, filename) {
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

// 3. Register the uploaded file with Shopify's fileCreate mutation
export async function shopifyFileCreate(shop, token, resourceUrl, filename) {
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
  const data = await res.json();
  const fileNode = data.data?.fileCreate?.files?.[0];
  if (!fileNode) throw new Error("File create failed");
  return fileNode;
}

// 4. Poll for CDN URL (file available for product media)
export async function pollShopifyFileCDNByFilename(shop, token, filename, intervalMs = 10000, maxTries = 40): Promise<string | null> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const url = await searchShopifyFileByFilename(shop, token, filename);
    if (url) return url;
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return null;
}

export async function searchShopifyFileByFilename(shop: string, token: string, filename: string): Promise<string | null> {
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
  const body = await res.json();
  const node = body?.data?.files?.edges?.[0]?.node;
  return node?.preview?.image?.url ?? null;
}

// 5. Attach file to product as product media
export async function attachImageToProduct(shop, token, productId, imageUrl, altText = "") {
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
  const data = await res.json();
  return data.data?.productCreateMedia?.media?.[0];
}
