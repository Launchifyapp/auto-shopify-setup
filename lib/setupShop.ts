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

    // productOptions structure for ProductInput
    type ProductOption = { name: string; values: { name: string }[] };
    const productOptions: ProductOption[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) {
        productOptions.push({
          name: name,
          values: Array.from(new Set(group.map((row: any) => row[`Option${i} Value`]).filter((v: any) => !!v && v.trim())))
            .map((v: string) => ({ name: v.trim() }))
        });
      }
    }

    // Prepare variants for bulk creation (step 2)
    const variants = group.map((row: any) => ({
      options: productOptions.map((opt, i) => row[`Option${i+1} Value`] ? row[`Option${i+1} Value`].trim() : ""),
      price: row["Variant Price"] || main["Variant Price"] || "0",
      compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
      sku: row["Variant SKU"] ? String(row["Variant SKU"]).trim() : "",
      barcode: row["Variant Barcode"] || undefined,
      requiresShipping: row["Variant Requires Shipping"] === "True",
      taxable: row["Variant Taxable"] === "True"
    }));

    products.push({
      handle,
      group,
      main,
      productOptions,
      variants
    });
  }
  return products;
}

// PATCH Shopify v2025-10+ : productCreate avec productOptions uniquement dans l'input,
// puis variantes créées en bulk via productVariantsBulkCreate
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const products = csvToStructuredProducts(csvText);

    let count = 0, errors: any[] = [];

    for (const { handle, group, main, productOptions, variants } of products) {
      let productId: string | undefined;
      try {
        // 1. Créer le produit avec productOptions (et PAS options ou variants)
        const productCreateInput = {
          title: main.Title,
          descriptionHtml: main["Body (HTML)"] || "",
          handle: handle + "-" + Math.random().toString(16).slice(2, 7),
          vendor: main.Vendor,
          productType: main["Type"] || main["Product Category"] || "",
          tags: cleanTags(main.Tags ?? main["Product Category"] ?? ""),
          status: "ACTIVE",
          productOptions
        };

        console.log(`[${handle}] Shopify productCreate input:`, JSON.stringify(productCreateInput, null, 2));
        const createRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product {
                    id
                    title
                    handle
                    options {
                      id
                      name
                      position
                      values
                    }
                  }
                  userErrors { field message }
                }
              }
            `,
            variables: { input: productCreateInput }
          }),
        });
        const createdJson: any = await createRes.json();
        productId = createdJson?.data?.productCreate?.product?.id;
        if (!productId) {
          errors.push({ handle, details: createdJson?.data?.productCreate?.userErrors ?? createdJson?.errors ?? "Unknown error" });
          console.error(`[${handle}] ERREUR productCreate`, JSON.stringify(createdJson?.data?.productCreate?.userErrors ?? createdJson?.errors, null, 2));
          continue;
        }
        count++;

        // 2. Ensuite créer les variants via productVariantsBulkCreate
        if (variants.length > 0) {
          console.log(`[${handle}] Shopify productVariantsBulkCreate input:`, JSON.stringify(variants, null, 2));
          const bulkRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
            body: JSON.stringify({
              query: `
                mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantInput!]!) {
                  productVariantsBulkCreate(productId: $productId, variants: $variants) {
                    product {
                      id
                      variants(first: 20) {
                        edges { node { id sku title price selectedOptions { name value } } }
                      }
                    }
                    userErrors { field message }
                  }
                }
              `,
              variables: { productId, variants }
            }),
          });
          const bulkJson: any = await bulkRes.json();
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            errors.push({ handle, details: bulkJson?.data?.productVariantsBulkCreate?.userErrors });
            console.error(`[${handle}] ERREUR productVariantsBulkCreate`, JSON.stringify(bulkJson?.data?.productVariantsBulkCreate?.userErrors, null, 2));
          }
        }

        // 3. Attacher images produit
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
        // Pour attacher une image à une variante, tu fais attachImageToVariant ici, en retrouvant l'id du variant via selectedOptions ou sku.

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
