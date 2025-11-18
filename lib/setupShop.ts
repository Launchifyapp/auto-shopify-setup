import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile } from "./batchUploadUniversal";
import { fetch } from "undici";

/** Détecte le séparateur du CSV ("," ou ";") */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.includes(";") ? ";" : ",";
}

/** Vérifie la validité de l'URL d'image */
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

/** Attache une image à un produit Shopify */
export async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
) {
  const media = [
    {
      originalSource: imageUrl,
      mediaContentType: "IMAGE",
      alt: altText,
    },
  ];
  await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
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
      variables: { productId, media },
    }),
  });
}

/** Attache une image à une variante Shopify */
export async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
) {
  await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
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
          image: { src: imageUrl, altText },
        },
      },
    }),
  });
}

/** Fonction principale: setup du shop - création produits, upload images, associations */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // <--- CHANGEZ LA SOURCE ICI EN PRODUCTS_images-url.csv si besoin ---->
    const csvPath = path.resolve("public", "Products_images-url.csv");
    const csvText = fs.readFileSync(csvPath, "utf8");
    const delimiter = guessCsvDelimiter(csvText);
    const records = parse(csvText, { columns: false, skip_empty_lines: true, delimiter });

    // Ici, on boucle sur chaque image trouvée dans le CSV
    for (const row of records.slice(1)) { // skip header
      const imageUrl = row[1];
      if (!validImageUrl(imageUrl)) continue;
      const filename = imageUrl.split("/").pop();
      const mimeType =
        filename?.endsWith('.png') ? "image/png"
        : filename?.endsWith('.webp') ? "image/webp"
        : "image/jpeg";
      if (!filename) continue;
      try {
        console.log(`[UPLOAD] Start ${filename}`);
        // --- CLEF : on écrit le buffer téléchargé sur disque avant upload ---
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error("Image inaccessible: " + imageUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        const tempPath = path.join("/tmp", filename.replace(/[^\w.\-]/g, "_"));
        fs.writeFileSync(tempPath, buf); // <-- Fichier local AVANT upload Shopify
        const cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
        if (cdnUrl) {
          console.log(`[UPLOAD] ${filename} → ${cdnUrl}`);
        } else {
          console.warn(`[UPLOAD] ${filename} → No CDN url found`);
        }
      } catch (err) {
        console.error(`[FAIL upload] ${filename}:`, err);
      }
    }
    // Ici, vous pouvez continuer avec la logique pour la création des produits/variantes si liée à images (mapping etc).
  } catch (err) {
    console.error("[Shopify] setupShop ERROR:", err);
  }
}
