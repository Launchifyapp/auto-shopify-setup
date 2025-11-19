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

// Conversion CSV natif Shopify -> structure utilisable
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

    // Noms des options extraites
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }
    // Liste unique de chaque valeur d'option
    const optionsToCreate = optionNames.map((name: string, idx: number) => ({
      name,
      values: Array.from(new Set(group.map((row: any) => row[`Option${idx+1} Value`]).filter((v: any) => !!v)))
    }));

    // Prépare variants pour la mutation bulk
    const variantsToCreate = group.map((row: any, idx: number) => ({
      options: optionNames.map((opt: string, i: number) => (row[`Option${i+1} Value`] || "").trim()),
      price: row["Variant Price"] || main["Variant Price"] || "0",
      compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
      sku: row["Variant SKU"] && String(row["Variant SKU"]).trim() ? String(row["Variant SKU"]).trim() : `SKU-${handle}-${idx+1}`,
      barcode: row["Variant Barcode"] || undefined,
      requiresShipping: row["Variant Requires Shipping"] === "True",
      taxable: row["Variant Taxable"] === "True"
    }));

    products.push({
      handle,
      group,
      main,
      optionNames,
      optionsToCreate,
      variantsToCreate
    });
  }
  return products;
}

// PIPELINE PATCHÉ Shopify Admin GraphQL API (API 2024+) : 3 étapes
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    // 1. get CSV
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();

    // 2. Parse CSV et structure data produits
    const products = csvToStructuredProducts(csvText);

    let count = 0, errors: any[] = [];

    for (const { handle, group, main, optionNames, optionsToCreate, variantsToCreate } of products) {
      let productId: string | undefined;
      try {
        // --- 1. Crée le produit (SANS options/variants) ---
        const productCreateInput = {
          title: main.Title,
          descriptionHtml: main["Body (HTML)"] || "",
          handle: handle + "-" + Math.random().toString(16).slice(2, 7),
          vendor: main.Vendor,
          productType: main["Type"] || main["Product Category"] || "",
          tags: cleanTags(main.Tags ?? main["Product Category"] ?? ""),
          status: "ACTIVE"
        };

        console.log(`[${handle}] Shopify productCreate input:`, JSON.stringify(productCreateInput, null, 2));
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
          errors.push({ handle, step: "productCreate", details: gqlJson?.data?.productCreate?.userErrors || gqlJson.errors || "Unknown error" });
          console.error(`[${handle}] ERREUR productCreate`, JSON.stringify(gqlJson?.data?.productCreate?.userErrors || gqlJson.errors, null, 2));
          continue;
        }
        count++;

        // --- 2. Ajoute les options au produit ---
        if (optionsToCreate.length > 0) {
          console.log(`[${handle}] Shopify productOptionsCreate input:`, JSON.stringify(optionsToCreate, null, 2));
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
              variables: { productId, options: optionsToCreate }
            }),
          });
          const optionsJson = await optionsRes.json() as any;
          if (optionsJson?.data?.productOptionsCreate?.userErrors?.length) {
            errors.push({ handle, step: "productOptionsCreate", details: optionsJson?.data?.productOptionsCreate?.userErrors });
            console.error(`[${handle}] ERREUR productOptionsCreate`, JSON.stringify(optionsJson?.data?.productOptionsCreate?.userErrors, null, 2));
            continue;
          }
        }

        // --- 3. Ajoute les variants au produit en bulk (bulkCreate !) ---
        if (variantsToCreate.length > 0) {
          console.log(`[${handle}] Shopify productVariantsBulkCreate input:`, JSON.stringify(variantsToCreate, null, 2));
          const bulkRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
            body: JSON.stringify({
              query: `
                mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantInput!]!) {
                  productVariantsBulkCreate(productId: $productId, variants: $variants) {
                    product {
                      id
                      variants(first: 50) {
                        edges { node { id sku title price selectedOptions { name value } } }
                      }
                    }
                    userErrors { field message }
                  }
                }
              `,
              variables: { productId, variants: variantsToCreate }
            }),
          });
          const bulkJson = await bulkRes.json() as any;
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            errors.push({ handle, step: "productVariantsBulkCreate", details: bulkJson?.data?.productVariantsBulkCreate?.userErrors });
            console.error(`[${handle}] ERREUR productVariantsBulkCreate`, JSON.stringify(bulkJson?.data?.productVariantsBulkCreate?.userErrors, null, 2));
          }
        }

        // --- Attache image produit principal
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

        // Pas d'image variant dans ce pipeline; tu peux intégrer attachImageToVariant ici si besoin (par conservation de l'id/sku/option).

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
