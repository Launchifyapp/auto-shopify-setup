import { parse } from "csv-parse/sync";

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      // Detection automatique du nombre et nom d'options
      const optionNames = [
        main["Option1 Name"]?.trim(),
        main["Option2 Name"]?.trim(),
        main["Option3 Name"]?.trim(),
      ].filter(Boolean);
      const productOptions = optionNames.length
        ? optionNames.map((optionName, idx) => ({
            name: optionName,
            values: [
              ...new Set(
                group
                  .map(row => row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim())
                  .filter((v: string | undefined) => !!v && v !== "Default Title")
              ),
            ].map(v => ({ name: v })),
          }))
        : undefined;

      // Handle unique à chaque import
      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

      const product: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
        productOptions,
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
                  product { id title handle options { id name position optionValues { id name hasVariants } } }
                  userErrors { field message }
                }
              }
            `,
            variables: { product },
          }),
        });
        const gqlJson = await gqlRes.json();
        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));
        const productId = gqlJson?.data?.productCreate?.product?.id;
        if (!productId) {
          console.warn("Aucun productId généré, erreur:", gqlJson?.data?.productCreate?.userErrors);
          continue;
        }

        // Création des variants uniquement s'il y a des options
        if (productOptions && productOptions.length > 0) {
          // Variant array construction, utilise toutes les options présentes
          const variants = group
            .filter(row => {
              // au moins 1 option value non vide et pas "Default Title"
              return optionNames.some((optionName, idx) =>
                row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim() !== "Default Title"
              );
            })
            .map(row => {
              // optionValues = array dynamique en fonction des options présentes
              const optionValues: string[] = [];
              optionNames.forEach((optionName, idx) => {
                const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
                if (value && value !== "Default Title") optionValues.push(value);
              });
              return {
                price: row["Variant Price"] || main["Variant Price"] || undefined,
                compareAtPrice: row["Variant Compare At Price"] || undefined,
                sku: row["Variant SKU"] || undefined,
                barcode: row["Variant Barcode"] || undefined,
                optionValues: optionValues.length ? optionValues : undefined,
              };
            })
            .filter(v => v.optionValues && v.optionValues.length); // skip variant if no optionValues

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

        // (Optionnel) Médiatisation images: utiliser le batch image après la création avec mapping produit/variant
        // Ici, tu peux juste préparer le mapping { handleUnique, productId } à utiliser plus bas.

      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
