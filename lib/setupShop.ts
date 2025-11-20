import { parse } from "csv-parse/sync";

// Utilitaire pour normaliser le domaine des urls images
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Fonction qui crée les produits Shopify et attache leurs images immédiatement après création.
// Structure actuelle, avec import multi-images produit + création produits/variants du vieux code (fiable) fusionné
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    // DELIMITER: correct pour ton CSV (;) !
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    // Regroupe les lignes du CSV par Handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // --- UTILS IMAGE SHOPIFY ---
    async function uploadImageToShopify(shop: string, token: string, imageUrl: string, filename: string): Promise<string> {
      if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;
      const normalizedUrl = normalizeImageUrl(imageUrl);
      const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({
          query: `
            mutation fileCreate($files: [FileCreateInput!]!) {
              fileCreate(files: $files) {
                files { url }
                userErrors { field message }
              }
            }
          `,
          variables: {
            files: [{
              originalSource: normalizedUrl,
              originalFileName: filename,
              mimeType: normalizedUrl.endsWith('.png') ? "image/png"
                : normalizedUrl.endsWith('.webp') ? "image/webp"
                : "image/jpeg"
            }]
          }
        })
      });
      const json = await res.json();
      if (json.data?.fileCreate?.files?.[0]?.url)
        return json.data.fileCreate.files[0].url;
      throw new Error("Upload image failed for " + filename + " | " + JSON.stringify(json));
    }

    async function attachImageToProduct(shop: string, token: string, productId: string, imageUrl: string, altText: string = "") {
      const media = [{
        originalSource: imageUrl,
        mediaContentType: "IMAGE",
        alt: altText
      }];
      const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-Shopify-Access-Token": token},
        body: JSON.stringify({
          query: `
            mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media { id alt }
                userErrors { field message }
              }
            }
          `,
          variables: { productId, media }
        })
      });
      const json = await res.json();
      if (json.data?.productCreateMedia?.userErrors?.length) {
        console.error("Erreur productCreateMedia:", JSON.stringify(json.data.productCreateMedia.userErrors));
      }
      return json;
    }

    // PATCH: multi-images produit via Set, attachement après product creation
    async function attachAllImagesToProduct(shop: string, token: string, productId: string, group: any[]) {
      const imagesToAttach = [
        ...new Set(group.map(row => row["Image Src"]).filter(Boolean))
      ];
      for (const imgUrl of imagesToAttach) {
        try {
          const cdnUrl = await uploadImageToShopify(shop, token, imgUrl, imgUrl.split('/').pop() ?? 'img.jpg');
          await attachImageToProduct(shop, token, productId, cdnUrl, "");
          console.log(`Image ajoutée au produit: ${productId} : ${imgUrl}`);
        } catch (err) {
          console.error(`Erreur upload/attach image produit ${productId}`, err);
        }
      }
    }

    // --- CREATION PRODUITS & VARIANTS (fusionné avec vieux code fiable) ---
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      // --- Création des options et mapping variants old code (fiable) ---
      type ProductOption = { name: string, values: { name: string }[] };
      const productOptions: ProductOption[] = [];
      for (let i = 1; i <= 3; i++) {
        const optionName = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
        if (optionName) {
          // Build unique values
          const optionValues = [
            ...new Set(group.map(row => row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : "").filter(v => !!v && v !== "Default Title"))
          ].map(v => ({ name: v }));
          if (optionValues.length) {
            productOptions.push({ name: optionName, values: optionValues });
          }
        }
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
        // --- Création produit principal Shopify ---
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
        const gqlJson = await gqlRes.json();
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

        // --- Attacher toutes les images PRODUIT (structure actuelle) PATCH ---
        await attachAllImagesToProduct(shop, token, productId, group);

        // --- Création variantes supplémentaires, mapping fiable ---
        // MAP variants from group
        const seen = new Set<string>();
        const variants = group
          .map(row => {
            // Build option values
            const optionValues: { name: string; optionName: string }[] = [];
            productOptions.forEach((opt, idx) => {
              const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
              if (value && value !== "Default Title") {
                optionValues.push({ name: value, optionName: opt.name });
              }
            });
            const key = optionValues.map(ov => ov.name).join('|');
            if (seen.has(key)) return undefined;
            seen.add(key);
            if (!optionValues.length) return undefined;
            return {
              price: row["Variant Price"] || main["Variant Price"] || "0",
              compareAtPrice: row["Variant Compare At Price"] || undefined,
              sku: row["Variant SKU"] || undefined,
              barcode: row["Variant Barcode"] || undefined,
              optionValues
            }
          })
          .filter(v => v && v.optionValues && v.optionValues.length);

        if (variants.length > 1) {
          // Mutate variants in bulk
          try {
            const bulkRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": token,
              },
              body: JSON.stringify({
                query: `
                  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                    productVariantsBulkCreate(productId: $productId, variants: $variants) {
                      productVariants { id sku price }
                      userErrors { field message }
                    }
                  }
                `,
                variables: { productId, variants: variants.slice(1) }, // slice(1) pour ne pas re-créer la première, déjà faite
              }),
            });
            const bulkJson = await bulkRes.json();
            if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
              console.error('Bulk variants userErrors:', bulkJson.data.productVariantsBulkCreate.userErrors);
            } else {
              console.log('Bulk variants response:', JSON.stringify(bulkJson, null, 2));
            }
          } catch (err) {
            console.error('Erreur bulk variants GraphQL', handleUnique, err);
          }
        }
        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.error('Erreur création produit GraphQL', handleUnique, err);
      }
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
