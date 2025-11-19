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

    // Construire variants array pour productCreate
    const variants = group.map((row: any, idx: number) => {
      // Shopify accepte option1, option2, option3; price, sku, etc.
      // Vérifie existence pour chaque option !
      return {
        option1: row["Option1 Value"] ? row["Option1 Value"].trim() : undefined,
        option2: row["Option2 Value"] ? row["Option2 Value"].trim() : undefined,
        option3: row["Option3 Value"] ? row["Option3 Value"].trim() : undefined,
        price: row["Variant Price"] || main["Variant Price"] || "0",
        compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
        sku: row["Variant SKU"] && String(row["Variant SKU"]).trim() ? String(row["Variant SKU"]).trim() : `SKU-${handle}-${idx+1}`,
        barcode: row["Variant Barcode"] || undefined,
        requiresShipping: row["Variant Requires Shipping"] === "True",
        taxable: row["Variant Taxable"] === "True"
      };
    });

    const productCreateInput: any = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: handle + "-" + Math.random().toString(16).slice(2, 7),
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      status: "ACTIVE",
      variants
    };

    products.push({
      handle,
      group,
      main,
      productCreateInput
    });
  }
  return products;
}

// MAIN FUNCTION - création modèle Shopify avec variants dans productCreate
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();

    const products = csvToStructuredProducts(csvText);

    let count = 0, errors: any[] = [];

    for (const { handle, group, main, productCreateInput } of products) {
      let productId: string | undefined;
      try {
        // --- 1. Crée produit + variants d'un coup ---
        console.log(`[${handle}] Shopify productCreate payload:`, JSON.stringify(productCreateInput, null, 2));
        const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product { id title handle variants(first: 50) { edges { node { id sku title price selectedOptions { name value } } } } }
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

        // --- 2. Attache image produit
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

        // --- 3. Attache image variantes si possible (mapping via option values)
        const createdVariants = gqlJson?.data?.productCreate?.product?.variants?.edges?.map((e: any) => e.node) || [];
        for (const v of createdVariants) {
          const variantMatch = group.find((row: any) =>
            // Shopfiy mapping: toutes options de v.selectedOptions doivent matcher row
            v.selectedOptions.every((o: any, idx: number) =>
              row[`Option${idx+1} Value`] && o.value === row[`Option${idx+1} Value`]
            )
          );
          // S'il existe une image pour cette variante, on l'attache
          if (variantMatch && validImageUrl(variantMatch["Variant Image"])) {
            try {
              await attachImageToVariant(shop, token, v.id, variantMatch["Variant Image"], variantMatch["Image Alt Text"] ?? "");
              console.log(`[${handle}] Image variante attachée ${variantMatch["Variant Image"]} -> variantId=${v.id}`);
            } catch (err) {
              console.error(`[${handle}] Erreur linkage image variant`, v.id, err);
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
