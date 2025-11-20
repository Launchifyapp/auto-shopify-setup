import fs from "fs";
import path from "path";
import { fetch } from "undici";
import { stagedUploadShopifyFile, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";
import { parse } from "csv-parse/sync";

// UTILS
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined" && /^https?:\/\/\S+$/i.test(v);
}
function parseCsvShopify(csvText: string): any[] {
  return parse(csvText, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    columns: true,
    quote: '"',
    trim: true
  });
}

// CSV > structure exploitable (handle, group, etc.)
function csvToStructuredProducts(csvText: string): any[] {
  const records = parseCsvShopify(csvText);
  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!row.Handle || !row.Handle.trim()) continue;
    productsByHandle[row.Handle] ??= [];
    productsByHandle[row.Handle].push(row);
  }
  const products: any[] = [];
  for (const [handle, group] of Object.entries(productsByHandle)) {
    const main = group.find((row: any) => row.Title && row.Title.trim()) || group[0];
    // Option names
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }
    products.push({ handle, group, main, optionNames });
  }
  return products;
}

// PIPELINE PATCH Shopify API (variants + media images)
export async function setupShop({ shop, token, session }: { shop: string; token: string; session: any }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const products = csvToStructuredProducts(csvText);

    for (const { handle, group, main, optionNames } of products) {
      // 1. Upload toutes les images nécessaires, et construire mapping image filename → mediaId
      const variantImageMap: Record<string, string> = {};
      for (const row of group) {
        const variantImageUrl = row["Variant Image"] ?? row["Image Src"];
        if (validImageUrl(variantImageUrl)) {
          // Upload image, enregistrer mediaId (obtenue via fileCreate + productCreateMedia)
          const file = await stagedUploadShopifyFile(shop, token, variantImageUrl);
          if (file?.id) variantImageMap[variantImageUrl] = file.id;
        }
      }

      // 2. Créer le produit avec les options
      // ... (productCreate étape ici, ou récupère son id si déjà créé via productCreate(input: { ... }))
      const productId = /* gid://shopify/Product/xxxxxxxxxxxxxx */ "A_COMPLETER";

      // 3. Préparer les variantes au format Shopify bulk
      const seen = new Set<string>();
      const variantsBulk: any[] = [];
      for (const row of group) {
        // Crée la clé unique
        const optionValues = optionNames.map((optionName, i) => ({
          name: row[`Option${i+1} Value`] ? row[`Option${i+1} Value`].trim() : "",
          optionName
        }));
        // Unicité + complétude
        if (optionValues.some(ov => !ov.name)) continue;
        const key = JSON.stringify(optionValues);
        if (seen.has(key)) continue;
        seen.add(key);

        // mediaId direct mapping si image
        let mediaId = undefined;
        const variantImageUrl = row["Variant Image"] ?? row["Image Src"];
        if (validImageUrl(variantImageUrl)) {
          mediaId = variantImageMap[variantImageUrl];
        }

        variantsBulk.push({
          optionValues,
          price: row["Variant Price"] || main["Variant Price"] || "0",
          sku: row["Variant SKU"] ? String(row["Variant SKU"]).trim() : "",
          barcode: row["Variant Barcode"] || undefined,
          mediaId,
          compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
          requiresShipping: row["Variant Requires Shipping"] === "True",
          taxable: row["Variant Taxable"] === "True",
        });
      }

      // --- DEBUG log variantsBulk ---
      console.log(`[DEBUG][${handle}] Variants bulk final à envoyer:`, JSON.stringify(variantsBulk, null, 2));

      // 4. Shopify productVariantsBulkCreate GraphQL avec mediaId
      // Utilisation structure Shopify cli/shopify-node-api
      const client = new shopify.clients.Graphql({ session });
      const data = await client.query({
        data: {
          query: `
            mutation CreateProductVariantsInBulkWithExistingMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkCreate(productId: $productId, variants: $variants) {
                product {
                  id
                }
                productVariants {
                  id
                  title
                  media(first: 10) {
                    nodes {
                      id
                      alt
                      mediaContentType
                      preview { status }
                    }
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            productId,
            variants: variantsBulk
          }
        }
      });

      console.log(`[DEBUG][${handle}] Shopify API bulkCreate retour:`, JSON.stringify(data, null, 2));
      if (data?.body?.data?.productVariantsBulkCreate?.userErrors?.length) {
        console.error(`[${handle}] userErrors:`, JSON.stringify(data.body.data.productVariantsBulkCreate.userErrors, null, 2));
      }
    }
    console.log("[Shopify] setupShop: DONE.");
    return { ok: true };
  } catch (err: any) {
    console.error("[Shopify] setupShop: FATAL ERROR", err);
    throw err;
  }
}
