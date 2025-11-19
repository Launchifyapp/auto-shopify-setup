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

    // Noms d'options, ex: ["Couleur", "Taille"]
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }

    // Options et valeurs
    const options = optionNames;

    // Prépare variants: chaque array "options" dans l'ordre des noms
    const variants = group.map((row: any) => ({
      options: optionNames.map((opt, i) => row[`Option${i+1} Value`] ? row[`Option${i+1} Value`].trim() : ""),
      price: row["Variant Price"] || main["Variant Price"] || "0",
      compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
      sku: row["Variant SKU"] && String(row["Variant SKU"]).trim() ? String(row["Variant SKU"]).trim() : "",
      barcode: row["Variant Barcode"] || undefined,
      requiresShipping: row["Variant Requires Shipping"] === "True",
      taxable: row["Variant Taxable"] === "True"
    }));

    products.push({
      handle,
      group,
      main,
      options,
      variants
    });
  }
  return products;
}

// PATCH Shopify v2024+ : productCreate (champ input, avec options et variants)
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const products = csvToStructuredProducts(csvText);

    let count = 0, errors: any[] = [];

    for (const { handle, group, main, options, variants } of products) {
      try {
        // Produit avec options et variants DIRECTEMENT dans "input"
        const productCreateInput = {
          title: main.Title,
          descriptionHtml: main["Body (HTML)"] || "",
          handle: handle + "-" + Math.random().toString(16).slice(2, 7),
          vendor: main.Vendor,
          productType: main["Type"] || main["Product Category"] || "",
          tags: cleanTags(main.Tags ?? main["Product Category"] ?? ""),
          status: "ACTIVE",
          options,      // ex: ["Couleur", "Taille"]
          variants      // array:
        };

        console.log(`[${handle}] Shopify productCreate input:`, JSON.stringify(productCreateInput, null, 2));
        const result = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
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
                    }
                    variants(first: 20) {
                      edges {
                        node {
                          id
                          title
                          sku
                          selectedOptions { name value }
                        }
                      }
                    }
                  }
                }
              }
            `,
            variables: { input: productCreateInput }
          }),
        });
        const jsonResult: any = await result.json();
        const productId = jsonResult?.data?.productCreate?.product?.id;
        if (!productId) {
          errors.push({ handle, details: jsonResult?.data?.productCreate?.userErrors ?? jsonResult?.errors ?? "Unknown error" });
          console.error(`[${handle}] ERREUR productCreate`, JSON.stringify(jsonResult?.data?.productCreate?.userErrors ?? jsonResult?.errors, null, 2));
          continue;
        }
        count++;
        // Affiche les variants générés automatiquement
        const variantsCreated = jsonResult?.data?.productCreate?.product?.variants?.edges ?? [];
        console.log(`[${handle}] Variants générés Shopify:`, JSON.stringify(variantsCreated, null, 2));

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
        // Possibilité d'ajouter ici attachImageToVariant sur chaque variant si tu veux
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
