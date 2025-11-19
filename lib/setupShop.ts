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

// Conversion du CSV natif Shopify vers la structure exploitable
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

    // --- payload for the first mutation
    // ALL variants are defined in this payload, as Shopify expects
    const variants = group.map((row: any, idx: number) => {
      const sku = row["Variant SKU"] && String(row["Variant SKU"]).trim() ? String(row["Variant SKU"]).trim() : `SKU-${handle}-${idx+1}`;
      // selectedOptions for each variant, as required by Shopify
      const selectedOptions = optionNames.map((opt, i) => ({
        name: opt,
        value: (row[`Option${i+1} Value`] || "").trim()
      })).filter(opt => !!opt.value);

      return {
        sku,
        price: row["Variant Price"] || main["Variant Price"] || "0",
        compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
        barcode: row["Variant Barcode"] || undefined,
        requiresShipping: row["Variant Requires Shipping"] === "True",
        taxable: row["Variant Taxable"] === "True",
        selectedOptions
      };
    });

    const productCreateInput: any = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: handle + "-" + Math.random().toString(16).slice(2, 7),
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      status: "ACTIVE", // IMPORTANT: must be uppercase
      options: optionNames,
      variants // bulk variants inside productCreate!
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

// MAIN FUNCTION - uses only productCreate for bulk creation
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
        // --- 3. CREATE PRODUCT AND BULK VARIANTS IN ONE MUTATION ---
        console.log(`[${handle}] Shopify productCreate payload:`, JSON.stringify(productCreateInput, null, 2));
        const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product { id title handle variants(first: 50) { edges { node { id sku title selectedOptions { name value } } } } }
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
          console.error(`[${handle}] Aucun productId généré. UserErrors/shopify errors:`, gqlJson?.data?.productCreate?.userErrors || gqlJson.errors);
          continue;
        }
        count++;

        // --- 4. Attache images produit principal
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

        // --- 5. Attache images variantes
        const createdVariants = gqlJson?.data?.productCreate?.product?.variants?.edges?.map((e: any) => e.node) || [];
        for (const [vidx, v] of createdVariants.entries()) {
          const row = group[vidx];
          if (!row) continue;
          if (validImageUrl(row["Variant Image"])) {
            try {
              await attachImageToVariant(shop, token, v.id, row["Variant Image"], row["Image Alt Text"] ?? "");
              console.log(`[${handle}] Image variante attachée ${row["Variant Image"]} -> variantId=${v.id}`);
            } catch (err) {
              console.error(`[${handle}] Erreur linkage image variant`, v.id, err);
            }
          }
        }

      } catch (err) {
        errors.push({ handle, details: err });
        console.error(`[${handle}] FATAL erreur setupShop pour le produit`, handle, err);
        continue;
      }
      await new Promise(res => setTimeout(res, 200)); // Rate-limit Shopify
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
