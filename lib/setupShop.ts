import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { fetch } from "undici";
import { stagedUploadShopifyFile, pollShopifyFileCDNByFilename, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";

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

/** Batch upload brut avec staged upload, ne poll PAS le CDN ici ! */
async function batchUploadImages(shop: string, token: string, images: { url: string; filename: string }[]) {
  for (const { url, filename } of images) {
    if (url.startsWith("https://cdn.shopify.com")) continue;
    try {
      // On upload en staging, la création file sera faite par la fonction stagedUploadShopifyFile
      await stagedUploadShopifyFile(shop, token, url);
      // NE poll PAS ici !
    } catch (err) {
      console.error('[BATCH-UPLOAD] FAIL', filename, err);
    }
  }
}

/**
 * Pipeline BATCH :
 * 1. Batch upload des images
 * 2. Création produits/variants
 * 3. Poll CDN & linkage d'image au moment de l'attachement produit/variant
 */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Lire CSV
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    console.log(`[Shopify] setupShop: parsed delimiter=${delimiter}`);

    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

    /** 2. Préparation du batch d'images à uploader */
    const imagesToUpload: { url: string; filename: string; type: "product" | "variant"; handle: string; altText: string }[] = [];
    for (const row of records) {
      if (validImageUrl(row["Image Src"])) {
        imagesToUpload.push({
          url: row["Image Src"],
          filename: row["Image Src"].split('/').pop() || "image.jpg",
          type: "product",
          handle: row.Handle,
          altText: row["Image Alt Text"] || ""
        });
      }
      if (validImageUrl(row["Variant Image"])) {
        imagesToUpload.push({
          url: row["Variant Image"],
          filename: row["Variant Image"].split('/').pop() || "variant.jpg",
          type: "variant",
          handle: row.Handle,
          altText: row["Image Alt Text"] || ""
        });
      }
    }

    /** 3. Batch upload de toutes les images, SANS polling CDN */
    await batchUploadImages(shop, token, imagesToUpload);

    /** 4. Regroupement par handle pour mapping produit/variante */
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    /** 5. Création produit + linkage images (poll CDN à ce moment) **/
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];
      type ProductOption = { name: string, values: { name: string }[] };
      type VariantNode = { id?: string; selectedOptions?: { name: string, value: string }[]; [key: string]: unknown; };

      // Structure options produits
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
        console.log(`[Shopify] Creating product: ${handleUnique}`);
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
        // 6. Pour chaque image à lier : on poll le CDN ici avant l'attachement
        for (const row of group) {
          const productImageUrl = row["Image Src"];
          const imageAltText = row["Image Alt Text"] ?? "";
          if (validImageUrl(productImageUrl)) {
            try {
              // On attend le CDN (poll) : on est sûr que le batch upload est déjà fait!
              const filename = productImageUrl.split('/').pop() ?? 'image.jpg';
              let cdnUrl: string | null = productImageUrl.startsWith("https://cdn.shopify.com")
                ? productImageUrl
                : await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
              if (!cdnUrl) {
                console.warn(`Image produit non trouvée CDN : ${filename}`);
                continue;
              }
              await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
              console.log(`Image rattachée au produit: ${handle} (row) → ${productId}`);
            } catch (err) {
              console.error("Erreur linkage image produit", handle, err);
            }
          }
        }

        // 7. Lien images variantes (idem, poll à la volée)
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          const matchingRows = group.filter(row =>
            [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
              .filter(Boolean)
              .join(":") === variantKey
          );
          for (const variantCsvRow of matchingRows) {
            const variantImageUrl = variantCsvRow?.["Variant Image"];
            const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
            if (v.id && validImageUrl(variantImageUrl)) {
              try {
                const filename = variantImageUrl.split('/').pop() ?? 'variant.jpg';
                let cdnUrl: string | null = variantImageUrl.startsWith("https://cdn.shopify.com")
                  ? variantImageUrl
                  : await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
                if (!cdnUrl) {
                  console.warn(`Image variante non trouvée CDN : ${filename}`);
                  continue;
                }
                await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
                console.log(`Image rattachée à variante: ${variantKey} → ${v.id}`);
              } catch (err) {
                console.error("Erreur linkage image variante", variantKey, err);
              }
            }
          }
        }
        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
    }
    console.log("[Shopify] setupShop: DONE.");
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
