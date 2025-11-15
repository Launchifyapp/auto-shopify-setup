import { parse } from "csv-parse/sync";

// Utilitaire pour normaliser le domaine des urls images
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Fonction qui crée les produits Shopify et attache leurs images immédiatement après création.
// Ne dépend pas d'écriture/lecture fichier JSON pour le mapping => compatible serverless/Next.js.
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });

    // Regroupe les lignes du CSV par Handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // Fonctions utilitaires image Shopify GraphQL
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

    async function attachImageToVariant(shop: string, token: string, variantId: string, imageUrl: string, altText: string = "") {
      const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({
          query: `
            mutation productVariantUpdate($input: ProductVariantUpdateInput!) {
              productVariantUpdate(input: $input) {
                productVariant { id image { id src altText } }
                userErrors { field message }
              }
            }
          `,
          variables: {
            input: {
              id: variantId,
              image: { src: imageUrl, altText }
            }
          }
        })
      });
      const json = await res.json();
      if (json.data?.productVariantUpdate?.userErrors?.length) {
        console.error("Erreur productVariantUpdate:", JSON.stringify(json.data.productVariantUpdate.userErrors));
      }
      return json;
    }

    // Traitement produit par produit
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      type ProductOption = { name: string, values: { name: string }[] };
      type VariantNode = {
        id?: string;
        selectedOptions?: { name: string, value: string }[];
        [key: string]: unknown;
      };

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
        // Création produit
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

        // Images pour le produit principal (première ligne du group)
        const productImageUrl = main["Image Src"];
        const imageAltText = main["Image Alt Text"] ?? "";
        if (productImageUrl) {
          let cdnUrl;
          try {
            cdnUrl = await uploadImageToShopify(shop, token, productImageUrl, productImageUrl.split('/').pop() ?? 'image.jpg');
            await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
            console.log(`Image rattachée au produit: ${handle} → ${productId}`);
          } catch (err) {
            console.error("Erreur upload/attach image produit", handle, err);
          }
        }

        // Création/gestion variante
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        const createdVariantsCount = createdVariantsArr.length;

        // Pour chaque variante existante, attache image si infos dans CSV
        for (const v of createdVariantsArr) {
          const variantKey = handle + ":" +
            (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          const variantCsvRow = group.find(row =>
            [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
            .filter(Boolean)
            .join(":") === (v.selectedOptions ?? []).map(opt => opt.value).join(":")
          );
          if (variantCsvRow && v.id && variantCsvRow["Image Src"]) {
            let variantImageUrl = variantCsvRow["Image Src"];
            let variantAltText = variantCsvRow["Image Alt Text"] ?? "";
            try {
              let cdnUrl = await uploadImageToShopify(shop, token, variantImageUrl, variantImageUrl.split('/').pop() ?? 'variant.jpg');
              await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
              console.log(`Image rattachée à variante: ${variantKey} → ${v.id}`);
            } catch (err) {
              console.error("Erreur upload/attach image variante", variantKey, err);
            }
          }
        }

        const expectedVariantsCount = group.filter(row =>
          productOptions.some((opt, idx) =>
            row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim() !== "Default Title"
          )
        ).length;

        if (productOptionsOrUndefined && createdVariantsCount < expectedVariantsCount) {
          const alreadyCreatedKeys = new Set<string>(
            createdVariantsArr.map((v: VariantNode) =>
              (v.selectedOptions ?? [])
                .map(opt => (opt.value || "").toLocaleLowerCase())
                .join("/")
            )
          );

          const variants = group
            .filter(row => productOptions.some((opt, idx) =>
              row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim() !== "Default Title"
            ))
            .map(row => {
              const key = [
                row["Option1 Value"]?.trim().toLocaleLowerCase(),
                row["Option2 Value"]?.trim().toLocaleLowerCase(),
                row["Option3 Value"]?.trim().toLocaleLowerCase()
              ].filter(Boolean).join("/");

              if (alreadyCreatedKeys.has(key)) return undefined;
              const optionValues: { name: string; optionName: string }[] = [];
              productOptions.forEach((opt, idx) => {
                const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
                if (value && value !== "Default Title")
                  optionValues.push({ name: value, optionName: opt.name });
              });
              return {
                price: row["Variant Price"] || main["Variant Price"] || undefined,
                compareAtPrice: row["Variant Compare At Price"] || undefined,
                sku: row["Variant SKU"] || undefined,
                barcode: row["Variant Barcode"] || undefined,
                optionValues: optionValues.length ? optionValues : undefined,
              };
            })
            .filter(v => v && v.optionValues && v.optionValues.length);

          if (variants.length) {
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
                  variables: { productId, variants },
                }),
              });
              const bulkJson = await bulkRes.json();
              if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
                console.error('Bulk variants userErrors:', bulkJson.data.productVariantsBulkCreate.userErrors);
              } else {
                console.log('Bulk variants response:', JSON.stringify(bulkJson, null, 2));
              }
            } catch (err) {
              console.log('Erreur bulk variants GraphQL', handleUnique, err);
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
