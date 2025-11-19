import fs from "fs";
import path from "path";
import { fetch } from "undici";
import { stagedUploadShopifyFile, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";
import { parse } from "csv-parse/sync";

// Vérifie la validité d'une URL
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v &&
    v !== "nan" &&
    v !== "null" &&
    v !== "undefined" &&
    /^https?:\/\/\S+$/i.test(v);
}

function cleanTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map(t => t.trim())
    .filter(t => t && !t.startsWith("<") && !t.startsWith("&") && t !== "null" && t !== "undefined" && t !== "NaN");
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

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();

    // PARSE CSV
    const records = parseCsvShopify(csvText);

    // Regroupe par handle (produit principal et variantes)
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!row.Handle || !row.Handle.trim()) continue;
      productsByHandle[row.Handle] ??= [];
      productsByHandle[row.Handle].push(row);
    }

    // Upload images produits et variantes d'abord pour disponibilité CDN immédiate
    const imagesToUpload: { url: string; filename: string }[] = [];
    for (const row of records) {
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
        console.log(`[setupShop BatchUpload OK] uploaded: "${img.url}"`);
      } catch (e) {
        console.error(`[setupShop BatchUpload FAIL] ${img.filename}:`, e);
      }
    }

    // Création des produits principaux puis de leurs variantes et associations images
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group.find(row => row.Title && row.Title.trim());
      if (!main || !main.Title || !main.Handle || !main.Vendor) {
        console.warn(`Skip product creation: Missing mandatory fields for handle=${main?.Handle}`);
        continue;
      }

      // Détection des noms d'options dynamiques : support 1, 2 ou 3 options !
      const optionNames = ["Option1 Name", "Option2 Name", "Option3 Name"]
        .map(opt => main[opt] && main[opt].trim())
        .filter(Boolean);

      // Génère handle unique pour éviter le conflit
      const handleUnique = main.Handle + "-" + Math.random().toString(16).slice(2, 7);

      // Crée le produit principal SANS variants/options
      const productPayload: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main["Type"] || main["Product Category"] || "",
        tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      };

      let productId: string | undefined;

      try {
        // 1. Crée le produit principal
        console.log(`[Shopify] productCreate:`, JSON.stringify(productPayload, null, 2));
        const gqlRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token
          },
          body: JSON.stringify({
            query: `
              mutation productCreate($product: ProductCreateInput!) {
                productCreate(product: $product) {
                  product { id title handle }
                  userErrors { field message }
                }
              }
            `,
            variables: { product: productPayload }
          }),
        });
        const gqlJson = await gqlRes.json() as any;
        productId = gqlJson?.data?.productCreate?.product?.id;
        if (!productId) {
          console.error(
            "[ERROR] Aucun productId généré.",
            "Réponse brute:", JSON.stringify(gqlJson)
          );
          continue;
        } else {
          console.log(`[Shopify] Product created [${handleUnique}] id=${productId}`);
        }
        if (gqlJson?.data?.productCreate?.userErrors?.length) {
          console.error(`[Shopify][ProductCreate] userErrors:`, gqlJson?.data?.productCreate?.userErrors);
        }
      } catch (err) {
        console.log('[ERROR] création produit GraphQL', handleUnique, err);
        continue;
      }

      // 2. Ajout des variantes dynamiques (multi-options), puis l'image de chaque variant !
      for (const variantRow of group) {
        // Reconstruit l'array selectedOptions pour toutes les options du produit (nom dynamique)
        const selectedOptions = optionNames.map(optionName => ({
          name: optionName,
          value: variantRow[`${optionName} Value`] || ""
        }));

        const hasValidOption = selectedOptions.some(o => o.value);
        if (!hasValidOption) {
          console.log(`[SKIP] Variant not created for row without selectedOptions:`, variantRow);
          continue;
        }

        const variantPayload: any = {
          productId,
          price: variantRow["Variant Price"] || main["Variant Price"] || "0",
          sku: variantRow["Variant SKU"],
          compareAtPrice: variantRow["Variant Compare At Price"] || main["Variant Compare At Price"],
          requiresShipping: variantRow["Variant Requires Shipping"] === "True",
          taxable: variantRow["Variant Taxable"] === "True",
          barcode: variantRow["Variant Barcode"],
          selectedOptions,
        };

        try {
          console.log(`[Shopify] productVariantCreate:`, JSON.stringify(variantPayload, null, 2));
          const gqlVariantRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": token
            },
            body: JSON.stringify({
              query: `
                mutation productVariantCreate($input: ProductVariantCreateInput!) {
                  productVariantCreate(input: $input) {
                    productVariant { id sku title selectedOptions { name value } }
                    userErrors { field message }
                  }
                }
              `,
              variables: { input: variantPayload }
            }),
          });
          const gqlVariantJson = await gqlVariantRes.json() as any;
          if (gqlVariantJson?.data?.productVariantCreate?.userErrors?.length) {
            console.error(`[Shopify][VariantCreate][ERROR] userErrors:`, gqlVariantJson?.data?.productVariantCreate?.userErrors);
          }
          const variantId = gqlVariantJson?.data?.productVariantCreate?.productVariant?.id;

          if (!variantId) {
            console.error(`[ERROR] Variant NOT CREATED for row:`, variantRow, "Réponse brute:", JSON.stringify(gqlVariantJson));
            continue;
          } else {
            console.log(`[Shopify] Variant created id=${variantId} sku=${variantPayload.sku} options=`, selectedOptions);
          }

          // Attache image spécifique pour la variante, si dispo
          if (variantId && validImageUrl(variantRow["Variant Image"])) {
            await attachImageToVariant(shop, token, variantId, variantRow["Variant Image"], variantRow["Image Alt Text"] ?? "");
            console.log(`[setupShop:VARIANT IMAGE ATTACHED] for variant id ${variantId}`);
          } else {
            console.log(`[setupShop][VARIANT IMAGE] Skipped for variantId=${variantId} / row:`, variantRow);
          }
        } catch (err) {
          console.error("[ERROR] création/update variant/image", handleUnique, err);
        }
        await new Promise(res => setTimeout(res, 100));
      }

      // 3. Attache les images produits
      for (const row of group) {
        const productImageUrl = row["Image Src"];
        const imageAltText = row["Image Alt Text"] ?? "";
        if (validImageUrl(productImageUrl)) {
          try {
            await attachImageToProduct(shop, token, productId!, productImageUrl, imageAltText);
            console.log(`[setupShop:PRODUCT IMAGE ATTACHED] for product id ${productId}`);
          } catch (err) {
            console.error("[ERROR] linkage image produit", handle, err);
          }
        }
      }
      await new Promise(res => setTimeout(res, 200)); // Rate-limit Shopify
    }
    console.log("[Shopify] setupShop: DONE.");
  } catch (err) {
    console.log("[ERROR] globale setupShop:", err);
  }
}
