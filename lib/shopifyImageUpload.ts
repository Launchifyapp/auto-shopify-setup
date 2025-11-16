import { Buffer } from "buffer";
import fs from "fs";

// Typing params (peut aussi contenir "filePath" si upload local)
export type ShopifyImageUploadParams = {
  url: string,           // URL publique, ou chemin absolu si local
  filename: string,
  mime_type: string,
  shop: string,
  token: string,
  filePath?: string      // Optionnel : chemin local (pour vrai buffer)
};

/**
 * Upload une image sur Shopify Files API.
 * - Tente d'abord le mode "source" (url publique)
 * - Si refus ou processing error, upload avec "attachment" (base64) utilisant un Buffer de lecture locale
 * Retourne l'URL Shopify CDN
 */
export async function uploadShopifyImage({
  url,
  filename,
  mime_type,
  shop,
  token,
  filePath
}: ShopifyImageUploadParams): Promise<string> {
  // 1. Tentative upload par URL source
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

  // Shopify peut répondre 201 ou 202 selon le plan, donc vérifie la présence de .file.url ou status code
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Shopify img upload failed: Non-JSON response (${res.status})`);
  }
  if (res.status === 201 && json?.file?.url) return json.file.url;

  // 2. Fallback by base64 attachment (lecture locale !)
  let base64Image: string;
  // Si filePath fourni et fichier existe
  if (filePath && fs.existsSync(filePath)) {
    base64Image = fs.readFileSync(filePath).toString("base64");
  } else {
    // Sinon, download depuis url publique (moins fiable sur certains Node/Vercel plans)
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`Could not fetch image ${url}, status: ${imgRes.status}`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    base64Image = imgBuf.toString("base64");
  }

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

  let json2;
  try {
    json2 = await res2.json();
  } catch (e) {
    throw new Error(`Shopify base64 upload failed: Non-JSON response (${res2.status})`);
  }
  if (res2.status === 201 && json2?.file?.url) return json2.file.url;

  // Si jamais Shopify renvoie une erreur "processing error", log tout le retour
  throw new Error(`Upload image failed for ${filename} | REST-source: ${JSON.stringify(json)} | REST-attachment: ${JSON.stringify(json2)}`);
}
