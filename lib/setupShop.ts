import { parse } from "csv-parse/sync";
import { Buffer } from "buffer";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile, searchShopifyFileByFilename } from "./batchUploadUniversal";
import { fetch } from "undici";

/** Détecter le séparateur ; ou , pour CSV Shopify FR/EN */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/**
 * Attache une image à un produit Shopify
 */
export async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
) {
  console.log(`[Shopify] Attaching image to productId=${productId}: imageUrl=${imageUrl ?? "null"}, altText="${altText}"`);
  const media = [
    {
      originalSource: imageUrl,
      mediaContentType: "IMAGE",
      alt: altText,
    },
  ];
  const res = await fetch(
    `https://${shop}/admin/api/2025-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              id
              status
              preview {
                image {
                  url
                }
              }
              mediaErrors {
                code
                message
              }
            }
            mediaUserErrors {
              code
              message
            }
          }
        }
        `,
        variables: { productId, media },
      }),
    }
  );
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`productCreateMedia failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  const mediaObj = json?.data?.productCreateMedia?.media?.[0];
  console.log(`[Shopify] productCreateMedia response: status=${mediaObj?.status}, url=${mediaObj?.preview?.image?.url ?? "null"}, mediaErrors=${JSON.stringify(mediaObj?.mediaErrors)}`);
  if (json.data?.productCreateMedia?.mediaUserErrors?.length) {
    console.error(`[Shopify] mediaUserErrors:`, JSON.stringify(json.data.productCreateMedia.mediaUserErrors));
  }
  return json;
}

/**
 * Attache une image à une variante Shopify
 */
export async function attachImageToVariant(shop: string, token: string, variantId: string, imageUrl: string, altText: string = "") {
  console.log(`[Shopify] Attaching image to variantId=${variantId}: imageUrl=${imageUrl ?? "null"}, altText="${altText}"`);
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantUpdate($input: ProductVariantUpdateInput!) {
          productVariantUpdate(input: $input) {
            productVariant { id image { id src altText } }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: {
          id: variantId,
          image: { src: imageUrl, altText }
        }
      }
    })
  });
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`productVariantUpdate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.productVariantUpdate?.userErrors?.length) {
    console.error("Erreur productVariantUpdate:", JSON.stringify(json.data.productVariantUpdate.userErrors));
  }
  return json;
}

/**
 * Upload universel: directe par URL (GraphQL fileCreate) si le domaine est accepté, sinon staged upload Shopify (stagedUploadsCreate + S3 + fileCreate).
 * Utilise le fallback filename direct: retrouve l'image dans Files et utilise la CDN, plus de polling MediaImage ID.
 */
export async function uploadImageToShopifyUniversal(shop: string, token: string, imageUrl: string, filename: string): Promise<string | null> {
  if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";
  // 1. Upload direct par URL via GraphQL
  console.log(`[Shopify] uploadImageToShopifyUniversal: uploading/creating ${filename}`);
  const fileCreateRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
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
      variables: { files: [{ originalSource: imageUrl, alt: filename }] }
    })
  });
  const fileCreateBodyText = await fileCreateRes.text();
  let fileCreateJson: any = null;
  try {
    fileCreateJson = JSON.parse(fileCreateBodyText);
  } catch {
    console.error(`[Shopify] fileCreate ERROR: ${fileCreateBodyText}`);
    throw new Error(`fileCreate failed: Non-JSON response (${fileCreateRes.status}) | Body: ${fileCreateBodyText}`);
  }
  if (fileCreateJson.data?.fileCreate?.userErrors?.length) {
    console.error('[Shopify] fileCreate userErrors:', JSON.stringify(fileCreateJson.data.fileCreate.userErrors));
    // Domaine bloqué : staged upload classique
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("download image error");
    const buf = Buffer.from(await imgRes.arrayBuffer());
    // Sauvegarde temporaire
    const tempPath = path.join("/tmp", filename.replace(/[^\w\.-]/g, "_"));
    fs.writeFileSync(tempPath, buf);
    let cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
    if (!cdnUrl) {
      console.warn(`[Shopify] CDN url not available after staged upload for ${filename}`);
      cdnUrl = await searchShopifyFileByFilename(shop, token, filename);
    }
    return cdnUrl ?? null;
  }
  // Utilisation DIRECTE du fallback Files CDN
  return await searchShopifyFileByFilename(shop, token, filename);
}
