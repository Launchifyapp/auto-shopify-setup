import fs from "fs";
import path from "path";
import { fetch } from "undici";
import { stagedUploadShopifyFile, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";
import { parse } from "csv-parse/sync";

// --- UTILS ---
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

// --- CSV -> structure exploitable et PATCH : variants doivent respecter l’ordre et l’unicité des options !
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
    // Récupérer les noms d’options dans l’ordre du produit
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) {
        productOptions.push({
          name: name,
          values: Array.from(new Set(group.map((row: any) => row[`Option${i} Value`]).filter((v: any) => !!v && v.trim())))
            .map((v: string) => ({ name: v.trim() }))
        });
        optionNames.push(name);
      }
    }

    // PATCH : Construction stricte et unique des variants
    const variantsRaw = group.map((row: any) => ({
      options: optionNames.map((opt, i) => row[`Option${i+1} Value`] ? row[`Option${i+1} Value`].trim() : ""),
      price: row["Variant Price"] || main["Variant Price"] || "0",
      compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"] || undefined,
      sku: row["Variant SKU"] ? String(row["Variant SKU"]).trim() : "",
      barcode: row["Variant Barcode"] || undefined,
      requiresShipping: row["Variant Requires Shipping"] === "True",
      taxable: row["Variant Taxable"] === "True"
    }));

    // --- LOG DEBUG BRUTS ---
    console.log(`[DEBUG][${handle}] variantsRaw du CSV :`, JSON.stringify(variantsRaw, null, 2));

    // PATCH : filtrer unicité, longueur et completude des options par Set sur JSON.stringify
    const seen = new Set<string>();
    const variants = variantsRaw.filter(v => {
      const key = JSON.stringify(v.options);
      if (seen.has(key)) return false;
      seen.add(key);
      if (v.options.length !== optionNames.length) return false;
      if (v.options.some(opt => !opt)) return false;
      return true;
    });

    // --- LOG DEBUG FILTRÉS ---
    console.log(`[DEBUG][${handle}] Variants filtrés (uniques et complets):`, JSON.stringify(variants, null, 2));

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

// --- PIPELINE PATCHÉ Shopify ---

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
        // 1. Créer le produit AVEC productOptions
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

        // Création produit
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
                    options { id name position values }
                    variants(first: 5) { edges { node { id title sku selectedOptions { name value } } } }
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

        // PATCH : Supprimer la variante "Default Title"
        const variantsDefault = createdJson?.data?.productCreate?.product?.variants?.edges ?? [];
        for (const v of variantsDefault) {
          if (v.node.title === "Default Title") {
            await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
              body: JSON.stringify({
                query: `
                  mutation productVariantDelete($id: ID!) {
                    productVariantDelete(id: $id) {
                      deletedProductVariantId
                      userErrors { field message }
                    }
                  }
                `,
                variables: { id: v.node.id }
              }),
            });
          }
        }

        // LOG FINAL AVANT ENVOI BULK
        console.log(`[DEBUG][${handle}] Variants à envoyer à productVariantsBulkCreate:`, JSON.stringify(variants, null, 2));
        // 2. Créer les variants en bulk avec options bien structurés
        if (variants.length > 0) {
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
          // LOG DU RETOUR BRUT
          console.log(`[DEBUG][${handle}] Shopify réponse bulkCreate:`, JSON.stringify(bulkJson, null, 2));
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            errors.push({ handle, details: bulkJson?.data?.productVariantsBulkCreate?.userErrors });
            console.error(`[DEBUG][${handle}] ERREUR userErrors:`, JSON.stringify(bulkJson?.data?.productVariantsBulkCreate?.userErrors, null, 2));
          } else {
            const created = bulkJson?.data?.productVariantsBulkCreate?.product?.variants?.edges ?? [];
            console.log(`[${handle}] Variants créés Shopify:`, JSON.stringify(created, null, 2));
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
