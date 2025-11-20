import fs from "fs";
import path from "path";
import { stagedUploadShopifyFile } from "./batchUploadUniversal";
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
    quote: '"',
    trim: true
  });
}

// CSV -> structure exploitable pour bulk variants + mediaId
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
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }
    products.push({ handle, group, main, optionNames });
  }
  return products;
}

// Fonction pour récupérer l'ID Shopify du produit via son handle
async function getProductIdByHandle(handle: string, shop: string, token: string): Promise<string | null> {
  // Shopify GraphQL : recherche par handle (slug du produit)
  const query = `
    query getProductIdByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        id
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query,
      variables: { handle }
    })
  });
  const data = await response.json();
  return data?.data?.productByHandle?.id || null;
}

// PATCH principal pour bulk import avec optionValues + mediaId
export async function setupShop({ shop, token, session }: { shop: string; token: string; session: any }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const products = csvToStructuredProducts(csvText);

    for (const { handle, group, main, optionNames } of products) {
      // 1. Upload images nécessaires pour les variantes et construction mapping imageUrl -> mediaId
      const variantImageMap: Record<string, string> = {};
      for (const row of group) {
        const variantImageUrl = row["Variant Image"] ?? row["Image Src"];
        if (validImageUrl(variantImageUrl)) {
          try {
            const file = await stagedUploadShopifyFile(shop, token, variantImageUrl);
            if (file?.id) variantImageMap[variantImageUrl] = file.id;
          } catch (err) {
            console.error(`[${handle}] Erreur upload image:`, variantImageUrl, err);
          }
        }
      }

      // 2. Récupérer automatiquement le productId avec le handle
      const productId = await getProductIdByHandle(handle, shop, token);
      if (!productId) {
        console.error(`[${handle}] Aucun productId trouvé pour le handle ${handle}! Skipping product.`);
        continue;
      }

      // 3. Préparer variants au format productVariantsBulkCreate Shopify avec optionValues + mediaId
      const seen = new Set<string>();
      const variantsBulk: any[] = [];
      for (const row of group) {
        const optionValues = optionNames.map((optionName: string, i: number) => ({
          name: row[`Option${i+1} Value`] ? String(row[`Option${i+1} Value`]).trim() : "",
          optionName
        }));
        if (optionValues.some((ov: { name: string; optionName: string }) => !ov.name)) continue;
        const key = JSON.stringify(optionValues);
        if (seen.has(key)) continue;
        seen.add(key);

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

      console.log(`[DEBUG][${handle}] Variants bulk final à importer:`, JSON.stringify(variantsBulk, null, 2));

      // 4. Shopify productVariantsBulkCreate avec shopify.clients.Graphql
      // ⚠️ Adapte ce require selon l'installation de shopify-api-node ou Shopify CLI
      const { clients } = require("shopify-api-node");
      const client = new clients.Graphql({ session });
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
                      preview {
                        status
                      }
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

      // LOGS bulk retour Shopify
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
