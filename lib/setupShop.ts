import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile, pollShopifyFileCDNByFilename } from "./batchUploadUniversal";
import { fetch } from "undici";

/** Détecter le séparateur ; ou , pour CSV Shopify FR/EN */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/** Vérifie que l'URL d'image est valide (ignore "nan", "null", "undefined", vide) */
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

/**
 * Attache une image à un produit Shopify
 */
export async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
) {
  // ... (garde ton code - inchangé)
}

/**
 * Attache une image à une variante Shopify
 */
export async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
) {
  // ... (garde ton code - inchangé)
}

/**
 * Upload universel et polling CDN
 */
export async function uploadImageToShopifyUniversal(
  shop: string,
  token: string,
  imageUrl: string,
  filename: string
): Promise<string | null> {
  if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";
  try {
    const cdnUrl = await stagedUploadShopifyFile(shop, token, imageUrl);
    if (cdnUrl) return cdnUrl;
    return await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
  } catch (err) {
    console.error("[Shopify] ERROR uploadImageToShopifyUniversal", err);
    return null;
  }
}

/**
 * PATCH : Upload toutes les images via le CSV des URLs et mapping CSV/Shopify CDN
 * Version adaptée à ton fichier CSV ; les URLs sont en colonne 1 (index 1) sans vrai nom de colonne.
 */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Parse le CSV d'URL d'images (les URLs sont dans colonne index 1 !)
    const csvPath = path.resolve("public", "Products_images-url.csv");
    const csvText = fs.readFileSync(csvPath, "utf8");
    const delimiter = guessCsvDelimiter(csvText);
    // On récupère les lignes en mode tableau (= pas columns:true car pas de header utile)
    const records = parse(csvText, { columns: false, skip_empty_lines: true, delimiter });

    // 2. Upload toutes les images du CSV (unique)
    const cdnMapping: Record<string, string> = {};
    for (const row of records.slice(1)) { // skip header
      const imageUrl = row[1];
      if (!validImageUrl(imageUrl)) continue;
      const filename = imageUrl.split("/").pop();
      if (!filename || cdnMapping[filename]) continue; // Ne réuploade pas !
      try {
        console.log(`[UPLOAD] Start ${filename}`);
        const cdnUrl = await stagedUploadShopifyFile(shop, token, imageUrl);
        if (cdnUrl) {
          cdnMapping[filename] = cdnUrl;
          console.log(`[UPLOAD] ${filename} → ${cdnUrl}`);
        } else {
          console.warn(`[UPLOAD] ${filename} → No CDN url found`);
        }
      } catch (err) {
        console.error(`[FAIL upload] ${filename}:`, err);
      }
    }

    // 3. Récupère le CSV produits/variantes 
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const productsCsvText = await response.text();
    const productsDelimiter = guessCsvDelimiter(productsCsvText);
    const productsRecords = parse(productsCsvText, { columns: true, skip_empty_lines: true, delimiter: productsDelimiter });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of productsRecords) {
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

      // ...setup des options produit, inchangé...
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
        try { gqlJson = JSON.parse(gqlBodyText); } catch { }
        const productData = gqlJson?.data?.productCreate?.product;
        const productId = productData?.id;
        if (!productId) continue;

        // Attache toutes les images PRODUIT selon mapping
        for (const row of group) {
          const productImageFilename = row["Image Src"]?.split("/").pop();
          const imageAltText = row["Image Alt Text"] ?? "";
          const productCdnUrl = productImageFilename ? cdnMapping[productImageFilename] : null;
          if (productCdnUrl) {
            try {
              await attachImageToProduct(shop, token, productId, productCdnUrl, imageAltText);
              console.log(`[CSV→CDN] Produit ${handle} avec image ${productImageFilename} attachée`);
            } catch (err) {
              console.error("Erreur attach image produit", handle, err);
            }
          }
        }

        // Attache toutes les images de VARIANTES selon mapping
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = handle + ":" + (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          const matchingVariantRows = group.filter(row =>
            [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
              .filter(Boolean)
              .join(":") === (v.selectedOptions ?? []).map(opt => opt.value).join(":")
          );
          for (const variantCsvRow of matchingVariantRows) {
            const variantImageFilename = variantCsvRow?.["Variant Image"]?.split("/").pop();
            const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
            const variantCdnUrl = variantImageFilename ? cdnMapping[variantImageFilename] : null;
            if (variantCdnUrl && v.id) {
              try {
                await attachImageToVariant(shop, token, v.id, variantCdnUrl, variantAltText);
                console.log(`[CSV→CDN] Variante ${variantKey} avec image ${variantImageFilename} attachée`);
              } catch (err) {
                console.error("Erreur attach image variante", handle, err);
              }
            }
          }
        }

        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
