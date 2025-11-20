import { parse } from "csv-parse/sync";

// --- Utilities ---
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

function extractCheckboxMetafields(row: any): any[] {
  const metafields: any[] = [];
  if (row["Checkbox 1 (product.metafields.custom.checkbox_1)"] !== undefined)
    metafields.push({
      namespace: "custom",
      key: "checkbox_1",
      type: "single_line_text_field",
      value: row["Checkbox 1 (product.metafields.custom.checkbox_1)"].toString()
    });
  if (row["Checkbox 2 (product.metafields.custom.checkbox_2)"] !== undefined)
    metafields.push({
      namespace: "custom",
      key: "checkbox_2",
      type: "single_line_text_field",
      value: row["Checkbox 2 (product.metafields.custom.checkbox_2)"].toString()
    });
  if (row["Checkbox 3 (product.metafields.custom.checkbox_3)"] !== undefined)
    metafields.push({
      namespace: "custom",
      key: "checkbox_3",
      type: "single_line_text_field",
      value: row["Checkbox 3 (product.metafields.custom.checkbox_3)"].toString()
    });
  return metafields;
}

// Delete a variant
async function deleteProductVariant(shop: string, token: string, variantId: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantDelete($id: ID!) {
          productVariantDelete(id: $id) {
            deletedProductVariantId
            userErrors { field message }
          }
        }
      `,
      variables: { id: variantId }
    })
  });
  return await res.json();
}

// Upload image en media produit Shopify
async function attachImageToProduct(shop: string, token: string, productId: string, imageUrl: string, altText: string = ""): Promise<string | undefined> {
  const media = [{
    originalSource: imageUrl,
    mediaContentType: "IMAGE",
    alt: altText
  }];
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { ... on MediaImage { id image { url } } }
            mediaUserErrors { field message }
          }
        }
      `,
      variables: { productId, media }
    })
  });
  const json = await res.json();
  return json?.data?.productCreateMedia?.media?.[0]?.id;
}

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      // Product Options
      type ProductOption = { name: string, values: { name: string }[] };
      const productOptions: ProductOption[] = [];
      for (let i = 1; i <= 3; i++) {
        const optionName = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
        if (optionName) {
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

      const productMetafields = extractCheckboxMetafields(main);

      // Product payload - NO variants, NO prices here
      const product: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
        productOptions: productOptionsOrUndefined,
        metafields: productMetafields.length > 0 ? productMetafields : undefined,
      };

      // --- 1. Create Product ---
      let productId = '';
      let defaultVariantId = '';
      try {
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
                    handle
                    variants(first: 1) {
                      edges { node { id title sku } }
                    }
                  }
                  userErrors { field message }
                }
              }
            `,
            variables: { product },
          }),
        });
        const gqlJson = await gqlRes.json();
        productId = gqlJson?.data?.productCreate?.product?.id;
        defaultVariantId = gqlJson?.data?.productCreate?.product?.variants?.edges?.[0]?.node?.id;
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(gqlJson, null, 2));
          continue;
        }
        console.log("Product créé avec id:", productId, "DefaultVariant:", defaultVariantId);
      } catch (err) {
        console.error('Erreur création produit GraphQL', handleUnique, err);
        continue;
      }

      // --- 2. Delete default variant ---
      if (defaultVariantId) {
        const delRes = await deleteProductVariant(shop, token, defaultVariantId);
        // Optionnel : affiche le retour pour audit
        console.log("Default variant deleted:", defaultVariantId, delRes);
      }

      // --- 3. Bulk create ALL variants, including price & compareAtPrice ---
      const variantsPayload = group.map(row => {
        const optionValues: { name: string; optionName: string }[] = [];
        productOptions.forEach((opt, idx) => {
          const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
          if (value && value !== "Default Title") {
            optionValues.push({ name: value, optionName: opt.name });
          }
        });
        return {
          price: row["Variant Price"] || main["Variant Price"] || "0",
          compareAtPrice: row["Variant Compare At Price"] || undefined,
          sku: row["Variant SKU"] || undefined,
          barcode: row["Variant Barcode"] || undefined,
          optionValues,
        };
      }).filter(v => v && v.optionValues && v.optionValues.length);

      // Pour les produits sans options (une variante unique, pas d'option!), il faut aussi gérer le cas...
      if (variantsPayload.length === 0) {
        variantsPayload.push({
          price: main["Variant Price"] || "0",
          compareAtPrice: main["Variant Compare At Price"] || undefined,
          sku: main["Variant SKU"] || undefined,
          barcode: main["Variant Barcode"] || undefined,
          optionValues: [],
        });
      }

      if (variantsPayload.length) {
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
                    productVariants { id sku price compareAtPrice }
                    userErrors { field message }
                  }
                }
              `,
              variables: { productId, variants: variantsPayload },
            }),
          });
          const bulkJson = await bulkRes.json();
          console.log("BulkVariants:", bulkJson?.data?.productVariantsBulkCreate?.productVariants);
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            console.warn("Bulk variants userErrors:", JSON.stringify(bulkJson.data.productVariantsBulkCreate.userErrors));
          }
        } catch (err) {
          console.error("Erreur BulkCreate variants", err);
          continue;
        }
      }

      // --- 4. Images produit ---
      const allImagesToAttach = [
        ...new Set([
          ...group.map(row => row["Image Src"]).filter(Boolean),
          ...group.map(row => row["Variant Image"]).filter(Boolean),
        ])
      ];
      for (const imgUrl of allImagesToAttach) {
        const normalizedUrl = normalizeImageUrl(imgUrl);
        await attachImageToProduct(shop, token, productId, normalizedUrl, "");
      }

      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
