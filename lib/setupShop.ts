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
      } catch (e) {
        console.error(`[setupShop BatchUpload FAIL] ${img.filename}:`, e);
      }
    }

    // Création des produits principaux avec variantes
    for (const [handle, group] of Object.entries(productsByHandle)) {
      // La première ligne du groupe (produit principal), contient les noms d'options
      const main = group.find(row => row.Title && row.Title.trim()) || group[0];
      if (!main || !main.Title || !main.Handle || !main.Vendor) {
        console.warn(`Skip product creation: Missing mandatory fields for handle=${main?.Handle}`);
        continue;
      }

      // 1. On récupère dynamiquement toutes les options sur la première ligne
      const optionNames: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
        if (name) optionNames.push(name);
      }

      // 2. Format Shopify : Array de variants (chaque ligne du groupe)
      const variants = group
        .filter(row => optionNames.some((name, idx) => row[`Option${idx + 1} Value`]))
        .map(row => ({
          sku: row["Variant SKU"],
          price: row["Variant Price"] || main["Variant Price"] || "0",
          compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"],
          requiresShipping: row["Variant Requires Shipping"] === "True",
          taxable: row["Variant Taxable"] === "True",
          barcode: row["Variant Barcode"],
          selectedOptions: optionNames.map((name, idx) => ({
            name,
            value: row[`Option${idx + 1} Value`] || ""
          })),
        }));

      // Génère handle unique pour éviter le conflit
      const handleUnique = main.Handle + "-" + Math.random().toString(16).slice(2, 7);

      // Crée le payload complet au format attendu par Shopify
      const productPayload: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main["Type"] || main["Product Category"] || "",
        tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
        options: optionNames, // <--- Tableau de chaînes, ex: ["Couleur", "Taille"]
        variants,             // <--- Tableau d'objets, chaque selectedOptions = [{name,value}]
      };

      let productId: string | undefined;

      try {
        // mutation must use ProductCreateInput!
        console.log(`[${handle}] ProductCreate payload:`, JSON.stringify(productPayload, null, 2));
        const gqlRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($product: ProductCreateInput!) {
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
            variables: { product: productPayload }
          }),
        });
        const gqlJson = await gqlRes.json() as any;
        productId = gqlJson?.data?.productCreate?.product?.id;
        if (!productId) {
          console.error(`[${handle}] Aucun productId généré. Réponse brute:`, JSON.stringify(gqlJson));
          continue;
        } else {
          console.log(`[${handle}] Produit principal et variantes créés, id ${productId}`);
          if (gqlJson?.data?.productCreate?.userErrors?.length)
            console.error(`[${handle}][ProductCreate] userErrors:`, gqlJson?.data?.productCreate?.userErrors);
        }
        // Récupérer tous les variants fraichement créés
        const createdVariants = gqlJson?.data?.productCreate?.product?.variants?.edges?.map((e: any) => e.node) || [];
        // Attache l'image de chaque variant si dispo
        for (const v of createdVariants) {
          const variantMatch = group.find(row =>
            optionNames.every((name, idx) =>
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
        console.log(`[${handle}] Erreur création produit/variants GraphQL`, handleUnique, err);
        continue;
      }

      // 5. Attache les images produits
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
    console.log("[Shopify] setupShop: DONE.");
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
