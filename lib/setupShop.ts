import fs from "fs";
import path from "path";
import { fetch } from "undici";
import { stagedUploadShopifyFile, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";
import { parse } from "csv-parse/sync";

function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined" && /^https?:\/\/\S+$/i.test(v);
}

function cleanTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags.split(",").map(t => t.trim()).filter(t =>
    t && !t.startsWith("<") && !t.startsWith("&") && t !== "null" && t !== "undefined" && t !== "NaN"
  );
}

function parseCsvShopify(csvText: string): any[] {
  return parse(csvText, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    quote: '"',
    trim: true
  });
}

// Conversion CSV natif Shopify -> structure exploitable
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

    // Option names for each product, ex: ["Couleur"]
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }

    // Values for productOptions array (Shopify unstable API structure)
    const productOptions = optionNames.map((name: string, idx: number) => ({
      name,
      values: Array.from(
        new Set(
          group.map((row: any) => row[`Option${idx+1} Value`])
          .filter((v: any) => !!v && v.trim())
        )
      ).map((value: string) => ({ name: value.trim() }))
    }));

    products.push({
      handle,
      group,
      main,
      productOptions
    });
  }
  return products;
}

/**
 * Pipeline Shopify : utilise la mutation productCreate avec productOptions intégré
 * Les variants sont générés automatiquement par Shopify via les combinaison d'options
 * Fonctionne sur API unstable ou toute version qui supporte product/productOptions dans productCreate
 */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const products = csvToStructuredProducts(csvText);

    let count = 0, errors: any[] = [];

    for (const { handle, group, main, productOptions } of products) {
      try {
        // 1. Build product payload for Shopify "unstable" API (direct productOptions)
        const productPayload: Record<string, any> = {
          title: main.Title,
          descriptionHtml: main["Body (HTML)"] || "",
          handle: handle + "-" + Math.random().toString(16).slice(2, 7),
          vendor: main.Vendor,
          productType: main["Type"] || main["Product Category"] || "",
          // Tag as array is accepted, but you can use string if preferred
          tags: cleanTags(main.Tags ?? main["Product Category"] ?? ""),
          status: "ACTIVE",
          productOptions // format must be: [{name, values: [{name}]}, ...]
        };
        console.log(`[${handle}] Shopify productCreate input:`, JSON.stringify(productPayload, null, 2));
        const result = await fetch(`https://${shop}/admin/api/unstable/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($product: ProductInput!) {
                productCreate(product: $product) {
                  userErrors {
                    field
                    message
                  }
                  product {
                    id
                    handle
                    title
                    options {
                      id
                      name
                      position
                      values
                      optionValues {
                        id
                        name
                        hasVariants
                      }
                    }
                    variants(first: 20) {
                      nodes {
                        id
                        title
                        sku
                        selectedOptions { name value }
                      }
                    }
                  }
                }
              }
            `,
            variables: { product: productPayload }
          }),
        });
        const jsonResult = await result.json();
        const productId = jsonResult?.data?.productCreate?.product?.id;
        if (!productId) {
          errors.push({ handle, details: jsonResult?.data?.productCreate?.userErrors ?? jsonResult?.errors ?? "Unknown error" });
          console.error(`[${handle}] ERREUR productCreate`, JSON.stringify(jsonResult?.data?.productCreate?.userErrors ?? jsonResult?.errors, null, 2));
          continue;
        }
        count++;
        // Affiche les variants générés automatiquement
        const variants = jsonResult?.data?.productCreate?.product?.variants?.nodes ?? [];
        console.log(`[${handle}] Variants générés Shopify:`, JSON.stringify(variants, null, 2));

        // Ajout images produit
        for (const row of group) {
          const productImageUrl = row["Image Src"];
          const imageAltText = row["Image Alt Text"] ?? "";
          if (validImageUrl(productImageUrl)) {
            try {
              await attachImageToProduct(shop, token, productId, productImageUrl, imageAltText);
              console.log(`[${handle}] Image produit attachée ${productImageUrl} -> productId=${productId}`);
            } catch (err) {
              console.error(`[${handle}] Erreur linkage image produit`, handle, err);
            }
          }
        }

        // Pour chaque variant généré, tu peux utiliser attachImageToVariant avec l’id du variant
        // (nécessite éventuellement de mapper option values <-> variant sku ou selectedOptions)

        await new Promise(res => setTimeout(res, 200));
      } catch (err) {
        errors.push({ handle, details: err });
        console.error(`[${handle}] FATAL erreur setupShop pour le produit`, handle, err);
        continue;
      }
    }

    if (errors.length) {
      console.error("[Shopify] setupShop ERREURS produits :", JSON.stringify(errors, null, 2));
      throw new Error("Erreurs sur " + errors.length + " produits : " + JSON.stringify(errors, null, 2));
    }

    console.log(`[Shopify] setupShop: DONE. Products created: ${count}`);
    return { ok: true, created: count };
  } catch (err: any) {
    console.error("[Shopify] setupShop: FATAL ERROR", err);
    throw err;
  }
}
