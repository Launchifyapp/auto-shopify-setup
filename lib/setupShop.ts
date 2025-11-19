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

    // --- payload minimal pour la première mutation
    const productCreateInput: any = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: main.Handle,
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(",")
      // NO options/variants here!
    };

    // Collect info for stages following product creation
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

// MAIN FUNCTION - compatible Shopify 2024+ API logic
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    // 1. get CSV
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    // 2. parse CSV
    const products = csvToStructuredProducts(csvText);

    // 3. UPLOAD toutes les images produits et variantes (CDN staging/caching)
    const imagesToUpload: { url: string; filename: string }[] = [];
    for (const { group } of products) {
      for (const row of group) {
        if (validImageUrl(row["Image Src"])) {
          imagesToUpload.push({
            url: row["Image Src"],
            filename: row["Image Src"].split('/').pop() || "image.jpg"
          });
        }
        if (validImageUrl(row["Variant Image"])) {
          imagesToUpload.push({
            url: row["Variant Image"],
            filename: row["Variant Image"].split('/').pop() || "variant.jpg"
          });
        }
      }
    }
    for (const img of imagesToUpload) {
      if (!validImageUrl(img.url) || !img.filename || !/\.(jpe?g|png|webp)$/i.test(img.filename)) {
        console.warn(`[setupShop BatchUpload SKIP] url invalid: "${img.url}" filename="${img.filename}"`);
        continue;
      }
      try {
        const imgBuffer = await fetch(img.url).then(res => res.arrayBuffer());
        const tempPath = path.join("/tmp", img.filename);
        fs.writeFileSync(tempPath, Buffer.from(imgBuffer));
        await stagedUploadShopifyFile(shop, token, tempPath);
      } catch (e) {
        console.error(`[setupShop BatchUpload FAIL] ${img.filename}:`, e);
      }
    }

    let count = 0, errors: any[] = [];

    for (const { handle, group, main, optionNames, productCreateInput } of products) {
      // handle unique pour éviter collision
      const handleUnique = productCreateInput.handle + "-" + Math.random().toString(16).slice(2, 7);
      productCreateInput.handle = handleUnique;

      let productId: string | undefined;
      try {
        // --- 4. M1: CRÉATION DU PRODUIT ---
        console.log(`[${handle}] Shopify productCreate payload:`, JSON.stringify(productCreateInput, null, 2));
        // Attention : input doit être passé avec "input" et le type ProductCreateInput!
        const gqlRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductCreateInput!) {
                productCreate(input: $input) {
                  product { id title handle options { id name values } }
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

        // --- 5. M2: AJOUT DES OPTIONS ---
        // On n'envoie cette mutation que si optionNames sont présents ET qu'il y a >1 value
        if (optionNames.length > 0) {
          // Extraire "values" de toutes options
          const productOptionsToCreate = optionNames.map((optName: string) => {
            // toutes les possible values pour cette colonne
            const values: string[] = Array.from(new Set(
              group.map((row: any) => row[`Option${optionNames.indexOf(optName)+1} Value`]).filter(v => !!v)
            ));
            return {
              name: optName,
              values
            };
          });
          console.log(`[${handle}] Shopify productOptionsCreate input:`, JSON.stringify(productOptionsToCreate, null, 2));
          const optionsRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
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
          const optionsJson = await optionsRes.json();
          if (optionsJson?.data?.productOptionsCreate?.userErrors?.length) {
            errors.push({ handle, details: optionsJson?.data?.productOptionsCreate?.userErrors });
            console.error(`[${handle}] ERREUR optionsCreate`, optionsJson?.data?.productOptionsCreate?.userErrors);
            continue;
          }
        }

        // --- 6. M3: CRÉATION BULK DES VARIANTS ---
        // Mapping Shopify productVariantsBulkCreate: "options" is just an array of values in order
        const variantsPayload = group.map((row: any) => {
          // Les values dans l'ordre des optionNames
          const values: string[] = optionNames.map((opt, idx) => row[`Option${idx+1} Value`] || "").filter(v => !!v);
          return {
            sku: row["Variant SKU"],
            price: row["Variant Price"] || main["Variant Price"] || "0",
            compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"],
            barcode: row["Variant Barcode"],
            requiresShipping: row["Variant Requires Shipping"] === "True",
            taxable: row["Variant Taxable"] === "True",
            options: values
          };
        });
        if (variantsPayload.length) {
          console.log(`[${handle}] Shopify productVariantsBulkCreate:`, JSON.stringify(variantsPayload, null, 2));
          const bulkRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
            body: JSON.stringify({
              query: `
                mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantBulkInput!]!) {
                  productVariantsBulkCreate(productId: $productId, variants: $variants) {
                    product {
                      id
                      variants(first: 50) {
                        edges {
                          node {
                            id sku title selectedOptions { name value }
                          }
                        }
                      }
                    }
                    userErrors { field message }
                  }
                }
              `,
              variables: { productId, variants: variantsPayload }
            }),
          });
          const bulkJson = await bulkRes.json();
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            errors.push({ handle, details: bulkJson?.data?.productVariantsBulkCreate?.userErrors });
            console.error(`[${handle}] ERREUR variantsBulkCreate`, bulkJson?.data?.productVariantsBulkCreate?.userErrors);
          }

          // Attaches d'images pour variants
          const createdVariants = bulkJson?.data?.productVariantsBulkCreate?.product?.variants?.edges?.map((e: any) => e.node) || [];
          for (const v of createdVariants) {
            // On recalcule matching
            const variantMatch = group.find((row: any) =>
              optionNames.every((name: string, idx: number) =>
                v.selectedOptions.some((o: any) => o.name === name && o.value === (row[`Option${idx + 1} Value`] || ""))
              ));
            if (variantMatch && validImageUrl(variantMatch["Variant Image"])) {
              try {
                await attachImageToVariant(shop, token, v.id, variantMatch["Variant Image"], variantMatch["Image Alt Text"] ?? "");
                console.log(`[${handle}] Image variante attachée ${variantMatch["Variant Image"]} -> variantId=${v.id}`);
              } catch (err) {
                console.error(`[${handle}] Erreur linkage image variant`, v.id, err);
              }
            }
          }
        }

      } catch (err) {
        errors.push({ handle, details: err });
        console.error(`[${handle}] FATAL erreur setupShop pour le produit`, handleUnique, err);
        continue;
      }

      // --- 7. Attache images produit principal
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
