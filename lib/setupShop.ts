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

// Convertit le CSV natif Shopify vers structure exploitable
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

    // Option names from first line (always in original order)
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }

    const productCreateInput: any = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: handle + "-" + Math.random().toString(16).slice(2, 7),
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      status: "ACTIVE"
    };

    products.push({
      handle,
      group,
      main,
      optionNames,
      productCreateInput
    });
  }
  return products;
}

// MAIN FUNCTION - compatible Shopify Admin GraphQL API
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    // 1. get CSV
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();

    // 2. parse CSV
    const products = csvToStructuredProducts(csvText);

    let count = 0, errors: any[] = [];

    for (const { handle, group, main, optionNames, productCreateInput } of products) {
      let productId: string | undefined;
      try {
        // --- 3. CREATE PRODUCT ---
        console.log(`[${handle}] Shopify productCreate payload:`, JSON.stringify(productCreateInput, null, 2));
        const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product { id title handle }
                  userErrors { field message }
                }
              }
            `,
            variables: { input: productCreateInput }
          }),
        });
        const gqlJson = await gqlRes.json() as any;
        productId = gqlJson?.data?.productCreate?.product?.id;
        if (!productId) {
          errors.push({ handle, details: gqlJson?.data?.productCreate?.userErrors || gqlJson.errors || "Unknown error" });
          console.error(`[${handle}] Aucun productId généré. UserErrors/shopify errors:`, JSON.stringify(gqlJson?.data?.productCreate?.userErrors || gqlJson.errors, null, 2));
          continue;
        }
        count++;

        // --- 4. CREATE OPTIONS (if any) ---
        if (optionNames.length > 0) {
          const productOptionsToCreate = optionNames.map((name: string) => ({
            name,
            values: Array.from(
              new Set(group.map((row: any) => row[`Option${optionNames.indexOf(name) + 1} Value`]).filter((v: any) => !!v))
            )
          }));
          console.log(`[${handle}] Shopify productOptionsCreate input:`, JSON.stringify(productOptionsToCreate, null, 2));

          const optionsRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
            body: JSON.stringify({
              query: `
                mutation productOptionsCreate($productId: ID!, $options: [ProductOptionInput!]!) {
                  productOptionsCreate(productId: $productId, options: $options) {
                    product { id options { id name values } }
                    userErrors { field message }
                  }
                }
              `,
              variables: { productId, options: productOptionsToCreate }
            }),
          });
          const optionsJson = await optionsRes.json() as any;
          if (optionsJson?.data?.productOptionsCreate?.userErrors?.length) {
            errors.push({ handle, details: optionsJson?.data?.productOptionsCreate?.userErrors });
            console.error(`[${handle}] ERREUR optionsCreate`, JSON.stringify(optionsJson?.data?.productOptionsCreate?.userErrors, null, 2));
            continue;
          }
        }

        // --- 5. CREATE VARIANTS ONE-BY-ONE ---
        for (const [vidx, row] of group.entries()) {
          // LOGS DEBUG : CSV + mapping
          console.log(`[${handle}] VARIANT INDEX=${vidx}`);
          console.log(`[${handle}] Variant CSV row:`, JSON.stringify(row, null, 2));
          console.log(`[${handle}] Option names:`, JSON.stringify(optionNames));
          console.log(`[${handle}] Raw mapping:`,
            optionNames.map((opt: string, i: number) => ({
              name: opt,
              value: (row[`Option${i+1} Value`] || "").trim()
            }))
          );

          const selectedOptions: { name: string; value: string }[] =
            optionNames.map((opt: string, i: number) => ({
              name: opt,
              value: (row[`Option${i+1} Value`] || "").trim()
            })).filter((optObj: { name: string; value: string }) => !!optObj.value);

          console.log(`[${handle}] selectedOptions:`, JSON.stringify(selectedOptions));
          const sku = row["Variant SKU"] && String(row["Variant SKU"]).trim() ? String(row["Variant SKU"]).trim() : `SKU-${handle}-${vidx+1}`;
          console.log(`[${handle}] Built SKU: ${sku}`);

          const variantInput = {
            productId,
            sku,
            price: row["Variant Price"] || main["Variant Price"] || "0",
            compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
            barcode: row["Variant Barcode"] || undefined,
            requiresShipping: row["Variant Requires Shipping"] === "True",
            taxable: row["Variant Taxable"] === "True",
            selectedOptions
          };

          console.log(`[${handle}] Shopify productVariantCreate input:`, JSON.stringify(variantInput, null, 2));

          const variantRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
            body: JSON.stringify({
              query: `
                mutation productVariantCreate($input: ProductVariantCreateInput!) {
                  productVariantCreate(input: $input) {
                    variant { id title selectedOptions { name value } }
                    userErrors { field message }
                  }
                }
              `,
              variables: { input: variantInput }
            }),
          });

          const variantJson = await variantRes.json() as any;
          console.log(`[${handle}] Shopify productVariantCreate response:`, JSON.stringify(variantJson, null, 2));

          if (variantJson?.data?.productVariantCreate?.userErrors?.length) {
            errors.push({ handle, details: variantJson?.data?.productVariantCreate?.userErrors });
            console.error(`[${handle}] ERREUR productVariantCreate`, JSON.stringify(variantJson?.data?.productVariantCreate?.userErrors, null, 2));
            continue;
          }

          // --- 6. OPTIONAL: Attach image to variant
          const variantId = variantJson?.data?.productVariantCreate?.variant?.id;
          if (variantId && validImageUrl(row["Variant Image"])) {
            try {
              await attachImageToVariant(shop, token, variantId, row["Variant Image"], row["Image Alt Text"] ?? "");
              console.log(`[${handle}] Image variante attachée ${row["Variant Image"]} -> variantId=${variantId}`);
            } catch (err) {
              console.error(`[${handle}] Erreur linkage image variant`, variantId, err);
            }
          }
        }

        // --- 7. OPTIONAL: Attach image to product
        for (const row of group) {
          const productImageUrl = row["Image Src"];
          const imageAltText = row["Image Alt Text"] ?? "";
          if (validImageUrl(productImageUrl)) {
            try {
              await attachImageToProduct(shop, token, productId!, productImageUrl, imageAltText);
              console.log(`[${handle}] Image produit attachée ${productImageUrl} -> productId=${productId}`);
            } catch (err) {
              console.error(`[${handle}] Erreur linkage image produit`, handle, err);
            }
          }
        }

        await new Promise(res => setTimeout(res, 200)); // Shopify rate limit

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
