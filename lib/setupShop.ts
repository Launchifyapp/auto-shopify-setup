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

      // Prépare les options, ignore "Default Title" ou vide
      type ProductOption = { name: string, values: { name: string }[] };
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
        const productData = gqlJson?.data?.productCreate?.product;
        const productId = productData?.id;
        if (!productId) {
          console.warn("Aucun productId généré, erreur:", gqlJson?.data?.productCreate?.userErrors);
          continue;
        }

        // On ne fait le bulk QUE si le produit créé n'a pas déjà généré les variants via productOptions
        const optionsFromApi = productData?.options || [];
        const hasActualVariants = optionsFromApi.some(
          (opt: any) => Array.isArray(opt.optionValues) && opt.optionValues.length > 0
        );

        if (productOptionsOrUndefined && !hasActualVariants) {
          const variants = group
            .filter(row => productOptions.some((opt, idx) =>
              row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim() !== "Default Title"
            ))
            .map(row => {
              const optionValues: { name: string; optionName: string }[] = [];
              productOptions.forEach((opt, idx) => {
                const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
                if (value && value !== "Default Title") {
                  optionValues.push({ name: value, optionName: opt.name });
                }
              });
              return {
                price: row["Variant Price"] || main["Variant Price"] || undefined,
                compareAtPrice: row["Variant Compare At Price"] || undefined,
                sku: row["Variant SKU"] || undefined,
                barcode: row["Variant Barcode"] || undefined,
                optionValues: optionValues.length ? optionValues : undefined,
              };
            })
            .filter(v => v.optionValues && v.optionValues.length);

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
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
