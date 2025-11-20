import { parse } from "csv-parse/sync";

// Utile pour normaliser le domaine ET la création d'une clé unique pour options
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, " ");
}

// Upload image en tant que media produit
async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
): Promise<string | undefined> {
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

// Bulk PATCH rattachement des images aux bonnes variantes
async function appendVariantMediaBulk(
  shop: string,
  token: string,
  productId: string,
  variantMedia: { variantId: string; mediaIds: string[] }[]
) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
          productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
            product { id }
            productVariants { id }
            userErrors { field message }
          }
        }
      `,
      variables: { productId, variantMedia }
    })
  });
  return await res.json();
}

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ";"
    });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      type ProductOption = { name: string, values: { name: string }[] };
      const productOptions: ProductOption[] = [];
      for (let i = 1; i <= 3; i++) {
        const optionName = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
        if (optionName) {
          const optionValues = [
            ...new Set(group.map(row => row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : "")
              .filter(v => !!v && v !== "Default Title")
            )
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
        // Création produit principal Shopify
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
                      edges { node { id sku title selectedOptions { name value } } }
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
        const productData = gqlJson?.data?.productCreate?.product;
        const productId = productData?.id;
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(gqlJson, null, 2));
          continue;
        }

        // Regroupe toutes les images uniques à uploader
        const allImagesToAttach = [
          ...new Set([
            ...group.map(row => row["Image Src"]).filter(Boolean),
            ...group.map(row => row["Variant Image"]).filter(Boolean),
          ])
        ];
        // Upload images
        const mediaMap: Record<string, string> = {};
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          const mediaId = await attachImageToProduct(shop, token, productId, normalizedUrl, "");
          if (mediaId) {
            mediaMap[normalizeKey(normalizedUrl)] = mediaId;
            console.log(`Media importé (${mediaId}) pour ${normalizedUrl}`);
          }
        }

        // Query sur le produit pour obtenir all variants et mapping par options
        const resVariants = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              query getVariants($productId: ID!) {
                product(id: $productId) {
                  variants(first: 50) {
                    edges { node { id selectedOptions { name value } } }
                  }
                }
              }
            `,
            variables: { productId }
          })
        });
        const jsonVariants = await resVariants.json();
        const allVariantsEdges = jsonVariants?.data?.product?.variants?.edges ?? [];
        const allVariantIds = allVariantsEdges.map((edge: { node: { id: string, selectedOptions: { value: string }[] } }) => ({
          variantId: edge.node.id,
          selectedOptions: edge.node.selectedOptions.map(opt => opt.value.trim()).join('|')
        }));

        // DEBUG mapping
        console.log("==== VARIANT SHOPIFY MAPPING (optionsKey => variantId) ====");
        for (const v of allVariantIds) {
          console.log(`optionsKey: "${normalizeKey(v.selectedOptions)}" => variantId: ${v.variantId}`);
        }
        console.log("==== MAPPING CSV (optionsKey pour chaque ligne) ====");
        for (const row of group) {
          const csvOptionsKey = productOptions.map((opt, idx) =>
            row[`Option${idx + 1} Value`] ? row[`Option${idx + 1} Value`].trim() : ''
          ).join('|');
          console.log(`optionsKey: "${normalizeKey(csvOptionsKey)}" pour Handle: ${row.Handle}, Variant Image: ${row["Variant Image"]}`);
        }

        // Mapping précis
        const variantMedia: { variantId: string; mediaIds: string[] }[] = [];
        for (const row of group) {
          const variantImageUrl = row["Variant Image"];
          if (!variantImageUrl) continue;
          const normalizedVariantImageUrl = normalizeImageUrl(variantImageUrl);
          const mediaId = mediaMap[normalizeKey(normalizedVariantImageUrl)];
          const optionsKey = productOptions.map((opt, idx) =>
            row[`Option${idx + 1} Value`] ? row[`Option${idx + 1} Value`].trim() : ''
          ).join('|');
          // Match sur la clé normalisée !
          const variantMapping = allVariantIds.find((v) => normalizeKey(v.selectedOptions) === normalizeKey(optionsKey));
          if (!variantMapping) {
            console.warn(`[DEBUG] Aucune variante trouvée pour CSV optionsKey=${normalizeKey(optionsKey)}; row=${JSON.stringify(row)}`);
          }
          if (!mediaId) {
            console.warn(`[DEBUG] Aucune mediaId trouvée pour image variant: ${normalizedVariantImageUrl}`);
          }
          if (variantMapping && mediaId) {
            variantMedia.push({
              variantId: variantMapping.variantId,
              mediaIds: [mediaId]
            });
          }
        }

        // Bulk PATCH rattachement images -> variantes
        if (variantMedia.length) {
          await appendVariantMediaBulk(shop, token, productId, variantMedia);
          console.log(`Rattachement bulk des images variantes effectué : ${variantMedia.length} liens`);
        }

        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.error('Erreur produit GraphQL', handleUnique, err);
      }
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
