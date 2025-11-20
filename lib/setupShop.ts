import { parse } from "csv-parse/sync";

// Normalize the image URLs
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Attach an image as media to the product (returns the created mediaId)
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
              ... on MediaImage {
                id
                alt
                image { url }
              }
            }
            mediaUserErrors { field message }
          }
        }
      `,
      variables: { productId, media }
    })
  });
  const json = await res.json();
  const createdMediaId = json?.data?.productCreateMedia?.media?.[0]?.id;
  if (!createdMediaId) {
    console.error("Erreur création media produit/shopify:", JSON.stringify(json, null, 2));
  }
  return createdMediaId;
}

// Attach a mediaId to a variant
async function attachImageToVariant(shop: string, token: string, variantId: string, mediaId: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantAppendMedia($variantId: ID!, $mediaIds: [ID!]!) {
          productVariantAppendMedia(variantId: $variantId, mediaIds: $mediaIds) {
            media {
              ... on MediaImage { id image { url } }
            }
            mediaUserErrors { field message }
          }
        }
      `,
      variables: { variantId, mediaIds: [mediaId] }
    })
  });
  const json = await res.json();
  if (json?.data?.productVariantAppendMedia?.mediaUserErrors?.length) {
    console.error("Erreur appendMedia variante:", JSON.stringify(json, null, 2));
  }
  return json;
}

// Get product media list as url+id pairs
async function getProductMedia(shop: string, token: string, productId: string): Promise<{ url?: string, id: string }[]> {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        query getMedia($productId: ID!) {
          product(id: $productId) {
            media(first: 20) {
              edges { node { ... on MediaImage { id image { url } } } }
            }
          }
        }
      `,
      variables: { productId }
    })
  });
  const json = await res.json();
  return json?.data?.product?.media?.edges?.map((edge: { node: { id: string, image: { url?: string } } }) => ({
    url: edge.node.image?.url,
    id: edge.node.id
  })) ?? [];
}

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    // Regroup by Handle
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
            ...new Set(group.map(row => row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : "").filter(v => !!v && v !== "Default Title"))
          ].map(v => ({ name: v }));
          if (optionValues.length) {
            productOptions.push({ name: optionName, values: optionValues });
          }
        }
      }
      const productOptionsOrUndefined = productOptions.length > 0 ? productOptions : undefined;
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
        // Create the product (with base options/variants)
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
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(gqlJson, null, 2));
          continue;
        }
        const productVariants = productData?.variants?.edges ?? [];
        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

        // Attach all images (deduped)
        const imagesToAttach = [...new Set(group.map(row => row["Image Src"]).filter(Boolean))];
        for (const imgUrl of imagesToAttach) {
          try {
            const normalizedUrl = normalizeImageUrl(imgUrl);
            await attachImageToProduct(shop, token, productId, normalizedUrl, "");
            console.log(`Image ajoutée au produit: ${productId} : ${imgUrl}`);
          } catch (err) {
            console.error(`Erreur upload/attach image produit ${productId} | ${imgUrl}`, err);
          }
        }

        // Media attachment to variants
        const medias = await getProductMedia(shop, token, productId);

        for (const v of productVariants) {
          const variantId = v.node?.id;
          if (!variantId) continue;
          const createdSelectedOpt = (v.node.selectedOptions ?? []).map((opt: any) => opt.value).join("|");
          const csvRow = group.find(row =>
            productOptions.map((opt, idx) => row[`Option${idx + 1} Value`]?.trim()).filter(Boolean).join("|") === createdSelectedOpt
          );
          if (csvRow?.["Variant Image"]) {
            const normalizedVariantImageUrl = normalizeImageUrl(csvRow["Variant Image"]);
            let mediaId = medias.find((m: { url?: string, id: string }) => m.url === normalizedVariantImageUrl)?.id;
            // Upload image as media if missing
            if (!mediaId) {
              try {
                mediaId = await attachImageToProduct(shop, token, productId, normalizedVariantImageUrl, "") || undefined;
                if (mediaId) medias.push({ url: normalizedVariantImageUrl, id: mediaId });
                else console.error(`Erreur création media pour image variant: ${normalizedVariantImageUrl}`);
              } catch (err) {
                console.error(`Erreur attach/mapping media image variant`, err);
              }
            }
            // Attach media to variant
            if (mediaId) {
              try {
                await attachImageToVariant(shop, token, variantId, mediaId);
                console.log(`Image de variante attachée à ${variantId}`);
              } catch (err) {
                console.error(`Erreur patch variant image ${variantId}`, err);
              }
            }
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
