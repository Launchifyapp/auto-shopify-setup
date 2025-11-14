import { parse } from 'csv-parse/sync';

// Fonction principale pour l'import produits Shopify via GraphQL API 2025-10
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Charger le CSV produits
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });

    // Regrouper les lignes par handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];
      const option1Name = main["Option1 Name"];
      const option1Values = group.map(row => row["Option1 Value"]?.trim()).filter(Boolean);

      // Préparer productOptions pour le nouveau schéma
      const productOptions: Array<{ name: string; values: Array<{ name: string }> }> = option1Name
        ? [{
            name: option1Name,
            values: [...new Set(option1Values)].map(v => ({ name: v }))
          }]
        : [];

      // Préparer la mutation GraphQL productCreate
      // les variants et images se rajoutent APRES la création du produit avec les mutations dédiées
      const product = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
        published: main.Published === "true",
        productOptions: productOptions.length ? productOptions : undefined
      };

      try {
        // Mutation productCreate classique du schéma 2025-10 (options dans productOptions)
        const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({
            query: `
              mutation productCreate($product: ProductInput!) {
                productCreate(product: $product) {
                  product { id title handle options { id name position optionValues { id name hasVariants } } }
                  userErrors { field message }
                }
              }
            `,
            variables: { product },
          }),
        });
        const gqlJson = await gqlRes.json();
        console.log('Produit créé', handle, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

        // Si l'id du produit existe on peut créer variants et images en mutation séparée
        const productId = gqlJson?.data?.productCreate?.product?.id;

        // 2. Création des variants (NE PAS inclure dans productCreate !)
        if (productId) {
          for (const row of group) {
            // Ne pas créer variant "Default Title" inutiles
            if (row["Option1 Value"] === "Default Title" || !row["Option1 Value"]) continue;
            const variant = {
              productId,
              price: row["Variant Price"] || main["Variant Price"] || undefined,
              compareAtPrice: row["Variant Compare At Price"] || undefined,
              requiresShipping: row["Variant Requires Shipping"] === "true",
              taxable: row["Variant Taxable"] === "true",
              fulfillmentService: row["Variant Fulfillment Service"] || undefined,
              inventoryPolicy: (row["Variant Inventory Policy"] || "DENY").toUpperCase(),
              weight: row["Variant Grams"] ? Number(row["Variant Grams"]) : undefined,
              weightUnit: (row["Variant Weight Unit"] || "KILOGRAMS").toUpperCase(),
              sku: row["Variant SKU"] || undefined,
              barcode: row["Variant Barcode"] || undefined,
              selectedOptions: option1Name
                ? [{ name: option1Name, value: row["Option1 Value"] }]
                : [],
            };

            // mutation productVariantCreate
            try {
              const variantRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Shopify-Access-Token": token,
                },
                body: JSON.stringify({
                  query: `
                    mutation productVariantCreate($input: ProductVariantInput!) {
                      productVariantCreate(input: $input) {
                        productVariant { id sku price selectedOptions { name value } }
                        userErrors { field message }
                      }
                    }
                  `,
                  variables: { input: variant },
                }),
              });
              const variantJson = await variantRes.json();
              console.log('Variant créé', handle, row["Option1 Value"], '| GraphQL response:', JSON.stringify(variantJson, null, 2));
            } catch (err) {
              console.log('Erreur création variant GraphQL', handle, err);
            }
            await new Promise(res => setTimeout(res, 200));
          }
        }

        // 3. Création des images via productImageCreate (si productId)
        if (productId) {
          const images = Array.from(new Set(
            group.map(row => row["Image Src"])
              .filter(src => typeof src === "string" && src.length > 6)
          )).map(src => ({
            productId,
            src,
            altText: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] ?? "",
          }));

          for (const image of images) {
            try {
              const imgRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Shopify-Access-Token": token,
                },
                body: JSON.stringify({
                  query: `
                    mutation productImageCreate($input: ProductImageInput!) {
                      productImageCreate(input: $input) {
                        image { id src altText }
                        userErrors { field message }
                      }
                    }
                  `,
                  variables: { input: image },
                }),
              });
              const imgJson = await imgRes.json();
              console.log('Image créée', handle, image.src, '| GraphQL response:', JSON.stringify(imgJson, null, 2));
            } catch (err) {
              console.log('Erreur création image GraphQL', handle, err);
            }
            await new Promise(res => setTimeout(res, 200));
          }
        }
      } catch (err) {
        console.log('Erreur création produit GraphQL', handle, err);
      }
      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
