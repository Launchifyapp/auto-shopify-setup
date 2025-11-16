import { Buffer } from "buffer";

export type ShopifyImageUploadParams = {
  url: string,
  filename: string,
  mime_type: string,
  shop: string,
  token: string
};

/**
 * Upload une image sur Shopify Files API.
 * - Tente d'abord le mode "source" (url publique)
 * - Si refus ou erreur Shopify, télécharge l'image puis upload en "attachment" (base64)
 */
export async function uploadShopifyImage({
  url,
  filename,
  mime_type,
  shop,
  token
}: ShopifyImageUploadParams): Promise<any> {
  // 1. Tente l'import par URL source
  const res = await fetch(`https://${shop}/admin/api/2023-07/files.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      file: { source: url, filename, mime_type }
    }),
  });
  if (res.status === 201) return await res.json();

  // 2. Fallback: télécharge l'image & upload en base64
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`Could not fetch image ${url} status ${imgRes.status}`);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  const base64Image = imgBuf.toString("base64");

  const res2 = await fetch(`https://${shop}/admin/api/2023-07/files.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      file: { attachment: base64Image, filename, mime_type }
    }),
  });
  return await res2.json();
}
