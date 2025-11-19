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

// CSV → Shopify API payload conversion
function csvToShopifyPayload(csvText: string): any[] {
  const records = parseCsvShopify(csvText);
  if (!records.length) {
    console.warn("[SetupShop] Aucune ligne parsée dans le CSV ! CSV source :\n", csvText.slice(0, 1000));
  }
  // Group by Handle
  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!row.Handle || !row.Handle.trim()) continue;
    productsByHandle[row.Handle] ??= [];
    productsByHandle[row.Handle].push(row);
  }
  const products: any[] = [];
  for (const [handle, group] of Object.entries(productsByHandle)) {
    const main = group.find((row: any) => row.Title && row.Title.trim()) || group[0];
    // Option names (first line)
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }
    // Variants
    const variants = group
      .filter((row: any) => optionNames.some((name, idx) => row[`Option${idx + 1} Value`]))
      .map((row: any) => ({
        sku: row["Variant SKU"],
        price: row["Variant Price"] || main["Variant Price"] || "0",
        compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"],
        requiresShipping: row["Variant Requires Shipping"] === "True",
        taxable: row["Variant Taxable"] === "True",
        barcode: row["Variant Barcode"],
        selectedOptions: optionNames.map((name, idx) => ({
          name,
          value: row[`Option${idx + 1} Value`] || ""
        })).filter(opt => opt.value),
      }));
    const payload = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: main.Handle,
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      options: optionNames,
      variants
    };
    products.push({ payload, handle, group });
  }
  return products;
}

// MAIN FUNCTION
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    // 1. fetch CSV distant
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    console.log("[Shopify] CSV téléchargé : Nb caractères =", csvText.length);

    // 2. parse CSV → array [{payload, handle, group}]
    const products = csvToShopifyPayload(csvText);
    console.log(`[Shopify] Nb produits importés : ${products.length}`);
    if (!products.length) {
      throw new Error("Aucun produit à importer ! CSV source :\n" + csvText.slice(0, 1000));
    }

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
    console.log(`[Shopify] Nb images à upload (produit+variant): ${imagesToUpload.length}`);
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
        console.log(`[setupShop BatchUpload OK]: ${img.filename}`);
      } catch (e) {
        console.error(`[setupShop BatchUpload FAIL] ${img.filename}:`, e);
      }
    }

    // 4. upload product + variants + images
    let count = 0, errors: any[] = [];
    for (const { payload, handle, group } of products) {
      // handle unique pour éviter les collisions sur le shop
      const handleUnique = payload.handle + "-" + Math.random().toString(16).slice(2, 7);
      payload.handle = handleUnique;

      // Correction mutation: ProductInput (et non ProductCreateInput !)
      let productId: string | undefined;
      try {
        console.log(`[${handle}] ProductCreate payload:`, JSON.stringify(payload, null, 2));
        const gqlRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($product: ProductInput!) {
                productCreate(product: $product) {
                  product {
                    id
                    title
                    handle
                    variants(first: 50) { edges { node { id sku title selectedOptions { name value } } } }
                    options { id name position optionValues { id name hasVariants } }
                  }
                  userErrors { field message }
                }
              }
            `,
            variables: { product: payload }
          }),
        });
        const gqlJson = await gqlRes.json() as any;
        if (gqlJson.errors) {
          console.error(`[${handle}] ERREUR Shopify GQL:`, JSON.stringify(gqlJson.errors));
        }
        productId = gqlJson?.data?.productCreate?.product?.id;

        if (!productId) {
          errors.push({ handle, details: gqlJson?.data?.productCreate?.userErrors || gqlJson.errors || "Unknown error" });
          console.error(`[${handle}] Aucun productId généré. UserErrors/shopify errors:`, gqlJson?.data?.productCreate?.userErrors || gqlJson.errors);
          continue;
        } else {
          count++;
          if (gqlJson?.data?.productCreate?.userErrors?.length)
            console.error(`[${handle}][ProductCreate] userErrors:`, gqlJson?.data?.productCreate?.userErrors);
        }

        // Récupère les variants Shopify
        const createdVariants = gqlJson?.data?.productCreate?.product?.variants?.edges?.map((e: any) => e.node) || [];
        // Attache image variant si dispo
        for (const v of createdVariants) {
          const variantMatch = group.find((row: any) =>
            payload.options.every((name: string, idx: number) =>
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
      } catch (err) {
        errors.push({ handle, details: err });
        console.error(`[${handle}] Erreur création produit/variants GraphQL`, handleUnique, err);
        continue;
      }

      // Attache images du produit principal
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
