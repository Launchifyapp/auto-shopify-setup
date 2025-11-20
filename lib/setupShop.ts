import { parse } from "csv-parse/sync";

function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Fonction d'extraction des metafields "checkbox" depuis les colonnes du CSV
function extractCheckboxMetafields(row: any): any[] {
  const metafields: any[] = [];
  if (row["Checkbox 1 (product.metafields.custom.checkbox_1)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_1",
      type: "single_line_text_field",
      value: row["Checkbox 1 (product.metafields.custom.checkbox_1)"].toString()
    });
  }
  if (row["Checkbox 2 (product.metafields.custom.checkbox_2)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_2",
      type: "single_line_text_field",
      value: row["Checkbox 2 (product.metafields.custom.checkbox_2)"].toString()
    });
  }
  if (row["Checkbox 3 (product.metafields.custom.checkbox_3)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_3",
      type: "single_line_text_field",
      value: row["Checkbox 3 (product.metafields.custom.checkbox_3)"].toString()
    });
  }
  return metafields;
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
            media {
              ... on MediaImage { id image { url } }
            }
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

      // Options
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

      // Metafields
      const productMetafields = extractCheckboxMetafields(main);

      // PAYLOAD SANS variants => variantes ajoutées en bulk ensuite
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

      // -- 1. mutation productCreate SANS variants --
      let productId;
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
                    variants(first: 50) {
                      edges { node { id sku title price selectedOptions { name value } } }
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
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(gqlJson, null, 2));
          continue;
        }
        console.log("Product créé avec id:", productId);
      } catch (err) {
        console.error('Erreur creation produit GraphQL', handleUnique, err);
        continue;
      }

      // -- 2. mutation productVariantsBulkCreate pour toutes les variantes (y compris la première, avec son prix) --
      const variantsPayload = group
        .map(row => {
          const optionValues: { name: string; optionName: string }[] = [];
          productOptions.forEach((opt, idx) => {
            const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
            if (value && value !== "Default Title") {
              optionValues.push({ name: value, optionName: opt.name });
            }
          });
          if (!optionValues.length) return null;
          return {
            price: row["Variant Price"] || main["Variant Price"] || "0",
            compareAtPrice: row["Variant Compare At Price"] || undefined,
            sku: row["Variant SKU"] || undefined,
            barcode: row["Variant Barcode"] || undefined,
            optionValues
          };
        })
        .filter(v => v && v.optionValues && v.optionValues.length);

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
                    productVariants { id sku price }
                    userErrors { field message }
                  }
                }
              `,
              variables: { productId, variants: variantsPayload },
            }),
          });
          const bulkJson = await bulkRes.json();
          if (bulkJson?.data?.productVariantsBulkCreate?.productVariants) {
            console.log("Variants bulk imported:", bulkJson.data.productVariantsBulkCreate.productVariants.map((v: { id: string; price: string }) => `${v.id}:${v.price}`));
          }
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            console.warn("Bulk variants userErrors:", JSON.stringify(bulkJson.data.productVariantsBulkCreate.userErrors));
          }
        } catch (err) {
          console.error("Erreur BulkCreate variants", err);
          continue;
        }
      }

      // -- 3. Images produit --
      const allImagesToAttach = [
        ...new Set([
          ...group.map(row => row["Image Src"]).filter(Boolean),
          ...group.map(row => row["Variant Image"]).filter(Boolean),
        ])
      ];
      const mediaMap: Record<string, string> = {};
      for (const imgUrl of allImagesToAttach) {
        const normalizedUrl = normalizeImageUrl(imgUrl);
        const mediaId = await attachImageToProduct(shop, token, productId, normalizedUrl, "");
        if (mediaId) {
          mediaMap[normalizedUrl] = mediaId;
          console.log(`Media importé (${mediaId}) pour ${normalizedUrl}`);
        }
      }

      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
