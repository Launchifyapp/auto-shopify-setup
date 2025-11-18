import fs from "fs";
import path from "path";
import { fetch } from "undici";
import { stagedUploadShopifyFile, pollShopifyFileCDNByFilename, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";
import { parse } from "csv-parse"; // compatible Next.js/Vercel CSV parser

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

// UTILITAIRE DE PARSING CSV ROBUSTE
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

    // ---- PARSE ROBUST ----
    const records = parseCsvShopify(csvText);

    // Regroupement par handle
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!row.Handle || !row.Handle.trim()) continue;
      productsByHandle[row.Handle] ??= [];
      productsByHandle[row.Handle].push(row);
    }

    // Upload toutes les images produits et variantes qui sont valides
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

    // Création produits + linkage images
    for (const [handle, group] of Object.entries(productsByHandle)) {
      // Prend le premier vrai produit
      const main = group.find(row => row.Title && row.Title.trim());

      // Validation des champs obligatoires
      if (!main || !main.Title || main.Title.trim() === "" || !main.Handle || !main.Vendor) {
        console.warn(`Skip product creation: Missing mandatory fields for handle=${main && main.Handle}`);
        continue;
      }

      // Mapping tags clean
      function cleanTags(tags) {
        if (!tags) return [];
        return tags
          .split(",")
          .map(t => t.trim())
          .filter(t => t && !t.startsWith("<") && !t.startsWith("&") && t !== "null" && t !== "undefined" && t !== "NaN");
      }

      // Options
      const optionNames = ["Option1 Name", "Option2 Name", "Option3 Name"].map(opt => main[opt]?.trim()).filter(Boolean);
      const allOptionValues = {};
      for (const name of optionNames) {
        allOptionValues[name] = Array.from(new Set(group.map(row => row[`${name} Value`]).filter(Boolean)));
      }
      const options = optionNames.map(name => ({
        name,
        values: allOptionValues[name]
      }));

      // Variants - chaque ligne du handle est un variant potentiel
      const variants = group.map(row => {
        const optionsArr = optionNames.map(opt => row[`${opt} Value`] || "").filter(Boolean);
        return {
          sku: row["Variant SKU"],
          price: row["Variant Price"],
          compareAtPrice: row["Variant Compare At Price"],
          requiresShipping: row["Variant Requires Shipping"] === "True",
          taxable: row["Variant Taxable"] === "True",
          barcode: row["Variant Barcode"],
          options: optionsArr,
          image: row["Variant Image"]
        };
      });

      const handleUnique = main.Handle + "-" + Math.random().toString(16).slice(2, 7);
      const product: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main["Type"] || main["Product Category"] || "",
        tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
        options,
        variants
      };

      try {
        // Création produit avec variants
        const gqlRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
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

        const gqlJson = await gqlRes.json() as any;
        const productData = gqlJson?.data?.productCreate?.product;
        const productId = productData?.id;
        if (!productId) {
          console.error(
            "Aucun productId généré.",
            "Réponse brute:", JSON.stringify(gqlJson)
          );
          continue;
        }

        // Link images produit
        for (const row of group) {
          const productImageUrl = row["Image Src"];
          const imageAltText = row["Image Alt Text"] ?? "";
          if (validImageUrl(productImageUrl)) {
            try {
              const filename = productImageUrl.split('/').pop() ?? 'image.jpg';
              const cdnUrl: string | null = productImageUrl.startsWith("https://cdn.shopify.com")
                ? productImageUrl
                : await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
              if (!cdnUrl) {
                console.warn(`Image produit non trouvée CDN : ${filename}`);
                continue;
              }
              await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
            } catch (err) {
              console.error("Erreur linkage image produit", handle, err);
            }
          }
        }

        // Link images variantes
        const createdVariantsArr: any[] = productData?.variants?.edges?.map((edge: { node: any }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = (v.selectedOptions ?? []).map((opt: any) => opt.value).join(":");
          const matchingRows = group.filter(row =>
            optionNames.map(opt => row[`${opt} Value`] || "").filter(Boolean).join(":") === variantKey
          );
          for (const variantCsvRow of matchingRows) {
            const variantImageUrl = variantCsvRow?.["Variant Image"];
            const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
            if (v.id && validImageUrl(variantImageUrl)) {
              try {
                const filename = variantImageUrl.split('/').pop() ?? 'variant.jpg';
                const cdnUrl: string | null = variantImageUrl.startsWith("https://cdn.shopify.com")
                  ? variantImageUrl
                  : await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
                if (!cdnUrl) {
                  console.warn(`Image variante non trouvée CDN : ${filename}`);
                  continue;
                }
                await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
              } catch (err) {
                console.error("Erreur linkage image variante", variantKey, err);
              }
            }
          }
        }
        await new Promise(res => setTimeout(res, 200)); // Rate-limit Shopify
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
    }
    console.log("[Shopify] setupShop: DONE.");
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
