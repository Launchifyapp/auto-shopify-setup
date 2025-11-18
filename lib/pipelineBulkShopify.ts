/**
 * Pipeline Shopify : batch upload images → création des produits/variantes → linkage images
 * Usage attendu : pipelineBulkShopifyBatch({ shop, token })
 */

import { parse } from "csv-parse/sync";
import { Buffer } from "buffer";
import path from "path";
import fs from "fs";
import { uploadImageToShopifyUniversal, attachImageToProduct, attachImageToVariant } from "./setupShop";
import { fetch } from "undici";

// Utilitaire pour CSV ; ou ,
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

// Validation URL image
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const val = url.trim().toLowerCase();
  return !!val && val !== "nan" && val !== "null" && val !== "undefined";
}

/**
 * Pipeline batch upload images → produits
 */
export async function pipelineBulkShopifyBatch({ shop, token }: { shop: string; token: string }) {
  // 1. Lire CSV
  console.log("[Shopify] pipelineBulkShopifyBatch: Fetch CSV...");
  const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  const delimiter = guessCsvDelimiter(csvText);
  console.log(`[Shopify] pipeline: parsed delimiter=${delimiter}`);

  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

  /** 2. Extraire toutes les images du CSV en batch unique **/
  const imagesMap = new Map<string, { url: string, filename: string, type: "product"|"variant", handle: string, altText: string }>();
  for (const row of records) {
    if (validImageUrl(row["Image Src"])) {
      const fname = row["Image Src"].split('/').pop() || "image.jpg";
      imagesMap.set(fname, {
        url: row["Image Src"],
        filename: fname,
        type: "product",
        handle: row.Handle,
        altText: row["Image Alt Text"] || ""
      });
    }
    if (validImageUrl(row["Variant Image"])) {
      const fnameVar = row["Variant Image"].split('/').pop() || "variant.jpg";
      imagesMap.set(fnameVar, {
        url: row["Variant Image"],
        filename: fnameVar,
        type: "variant",
        handle: row.Handle,
        altText: row["Image Alt Text"] || ""
      });
    }
  }

  /** 3. Batch upload toutes les images en amont, stockage CDN url **/

  const cdnUrlByFilename: Record<string, string> = {};
  for (const [fname, img] of imagesMap.entries()) {
    if (img.url.startsWith("https://cdn.shopify.com")) {
      cdnUrlByFilename[fname] = img.url;
      continue;
    }
    try {
      const cdnUrl = await uploadImageToShopifyUniversal(shop, token, img.url, img.filename);
      if (cdnUrl) {
        cdnUrlByFilename[fname] = cdnUrl;
      } else {
        console.warn(`Batch upload: No CDN url for image ${fname}`);
      }
    } catch (err) {
      console.error(`[BATCH UPLOAD FAIL] ${fname}:`, err);
    }
  }

  /** 4. Création des produits + variantes **/
  // Regroupe chaque handle avec toutes ses lignes CSV
  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
    productsByHandle[row.Handle].push(row);
  }

  for (const [handle, group] of Object.entries(productsByHandle)) {
    const main = group[0];

    type ProductOption = { name: string, values: { name: string }[] };
    type VariantNode = {
      id?: string;
      selectedOptions?: { name: string, value: string }[];
      [key: string]: unknown;
    };

    // Valeurs d’options produites (1/2/3)
    const optionValues1: { name: string }[] = [...new Set(group.map(row => (row["Option1 Value"] || "").trim()))]
      .filter(v => !!v && v !== "Default Title")
      .map(v => ({ name: v }));
    const optionValues2: { name: string }[] = [...new Set(group.map(row => (row["Option2 Value"] || "").trim()))]
      .filter(v => !!v && v !== "Default Title")
      .map(v => ({ name: v }));
    const optionValues3: { name: string }[] = [...new Set(group.map(row => (row["Option3 Value"] || "").trim()))]
      .filter(v => !!v && v !== "Default Title")
      .map(v => ({ name: v }));

    const productOptions: ProductOption[] = [];
    if (main["Option1 Name"] && optionValues1.length) {
      productOptions.push({ name: main["Option1 Name"].trim(), values: optionValues1 });
    }
    if (main["Option2 Name"] && optionValues2.length) {
      productOptions.push({ name: main["Option2 Name"].trim(), values: optionValues2 });
    }
    if (main["Option3 Name"] && optionValues3.length) {
      productOptions.push({ name: main["Option3 Name"].trim(), values: optionValues3 });
    }
    const productOptionsOrUndefined = productOptions.length ? productOptions : undefined;

    const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

    const product: any = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: handleUnique,
      vendor: main.Vendor,
      productType: main.Type,
      tags: main.Tags?.split(",").map((t: string) => t.trim()),
      productOptions: productOptionsOrUndefined,
    };

    try {
      console.log(`[Shopify] Creating product: ${handleUnique}`);
      // Création du produit
      const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: `
            mutation productCreate($product: ProductCreateInput!) {
              productCreate(product: $product) {
                product {
                  id
                  title
                  handle
                  variants(first: 50) {
                    edges { node { id sku title selectedOptions { name value } } }
                  }
                  options { id name position optionValues { id name hasVariants } }
                }
                userErrors { field message }
              }
            }
          `,
          variables: { product },
        }),
      });

      const gqlBodyText = await gqlRes.text();
      let gqlJson: any = null;
      try {
        gqlJson = JSON.parse(gqlBodyText);
      } catch {
        console.error(`[Shopify] productCreate ERROR: ${gqlBodyText}`);
        throw new Error(`productCreate failed: Non-JSON response (${gqlRes.status}) | Body: ${gqlBodyText}`);
      }

      const productData = gqlJson?.data?.productCreate?.product;
      const productId = productData?.id;
      const userErrors = gqlJson?.data?.productCreate?.userErrors ?? [];
      if (!productId) {
        console.error(
          "Aucun productId généré.",
          "userErrors:", userErrors.length > 0 ? userErrors : "Aucune erreur Shopify.",
          "Réponse brute:", JSON.stringify(gqlJson, null, 2)
        );
        continue;
      }
      console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

      /** 5. Attache les images produits pré-uploadées (via CDN) **/
      for (const row of group) {
        const productImageUrl = row["Image Src"];
        const imageAltText = row["Image Alt Text"] ?? "";
        if (validImageUrl(productImageUrl)) {
          try {
            const filename = productImageUrl.split('/').pop() ?? 'image.jpg';
            // Cherche l’URL CDN conservée lors du batch
            const cdnUrl = cdnUrlByFilename[filename];
            if (!cdnUrl) {
              console.warn(`Image non uploadée : ${filename}`);
              continue;
            }
            await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
            console.log(`Image rattachée au produit: ${handle} (row) → ${productId}`);
          } catch (err) {
            console.error("Erreur attachement image produit", handle, err);
          }
        }
      }

      /** 6. Attache les images variantes pré-uploadées (via CDN) **/
      const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
      for (const v of createdVariantsArr) {
        const keyVariant = (v.selectedOptions ?? []).map(opt => opt.value).join(":");
        const matchingRows = group.filter(row =>
          [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
              .filter(Boolean)
              .join(":") === keyVariant
        );
        for (const variantCsvRow of matchingRows) {
          const variantImageUrl = variantCsvRow?.["Variant Image"];
          const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
          if (
            v.id &&
            validImageUrl(variantImageUrl)
          ) {
            try {
              const filename = variantImageUrl.split('/').pop() ?? 'variant.jpg';
              const cdnUrl = cdnUrlByFilename[filename];
              if (!cdnUrl) {
                console.warn(`Image variante non uploadée : ${filename}`);
                continue;
              }
              await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
              console.log(`Image rattachée à variante: ${keyVariant} → ${v.id}`);
            } catch (err) {
              console.error("Erreur attachement image variante", keyVariant, err);
            }
          }
        }
      }
      await new Promise(res => setTimeout(res, 300));
    } catch (err) {
      console.log('Erreur création produit GraphQL', handleUnique, err);
    }
  }

  console.log("[Shopify] pipelineBulkShopifyBatch: DONE.");
}
