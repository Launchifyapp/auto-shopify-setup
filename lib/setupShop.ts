import { parse } from "csv-parse/sync";

// Utile pour normaliser le domaine
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Récupère tous les medias du produit (media images)
async function getProductMedia(shop: string, token: string, productId: string): Promise<{ id: string, status: string, url?: string }[]> {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        query getMedia($productId: ID!) {
          product(id: $productId) {
            media(first: 20) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    status
                    image { url }
                  }
                }
              }
            }
          }
        }
      `,
      variables: { productId }
    })
  });
  const json = await res.json();
  return json?.data?.product?.media?.edges?.map((edge: { node: { id: string, status: string, image: { url?: string } } }) => ({
    id: edge.node.id,
    status: edge.node.status,
    url: edge.node.image?.url
  })) ?? [];
}

// Upload image en media produit, retourne mediaId si upload ok
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
              ... on MediaImage { id status image { url } }
            }
            mediaUserErrors { field message }
          }
        }
      `,
      variables: { productId, media }
    })
  });
  const json = await res.json();
  const createdMedia = json?.data?.productCreateMedia?.media?.[0];
  return createdMedia?.id;
}

// Attache image à une variante via mediaId & logs response
async function appendImageToVariant(shop: string, token: string, variantId: string, mediaId: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantAppendMedia($variantId: ID!, $mediaIds: [ID!]!) {
          productVariantAppendMedia(variantId: $variantId, mediaIds: $mediaIds) {
            media { ... on MediaImage { id image { url } } }
            mediaUserErrors { field message }
          }
        }
      `,
      variables: { variantId, mediaIds: [mediaId] }
    })
  });
  const json = await res.json();
  console.log("AppendImageToVariant response:", JSON.stringify(json, null, 2));
  return json;
}

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    // Group lines by Handle
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
        // Product creation
        const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
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

        // Upload all images from Image Src and Variant Image (deduped) as media
        const allImagesToAttach = [
          ...new Set([
            ...group.filter(row => !row["Option1 Value"] && row["Image Src"]).map(row => row["Image Src"]),
            ...group.filter(row => row["Option1 Value"] && row["Variant Image"]).map(row => row["Variant Image"]),
          ])
        ];
        const mediaMap: Record<string, string> = {};
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          const mediaId = await attachImageToProduct(shop, token, productId, normalizedUrl, "");
          if (mediaId) mediaMap[normalizedUrl] = mediaId;
          // ATTEND le traitement Shopify !
          await new Promise(res => setTimeout(res, 2000));
        }

        // Query all variants & map optionsKey
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
          optionsKey: edge.node.selectedOptions.map(opt => opt.value.trim().toLowerCase()).join('|')
        }));

        // Media/variant mapping: only for lines with options + Variant Image
        for (const row of group.filter(row => row["Option1 Value"] && row["Variant Image"])) {
          const normalizedVariantImageUrl = normalizeImageUrl(row["Variant Image"]);
          // TROUVE le dernier status du media
          let attachMediaId: string | undefined = undefined;
          let readyStatus = false;

          for (let pollCount = 0; pollCount < 10; pollCount++) {
            const mediasProduct = await getProductMedia(shop, token, productId);
            const matchingMedia = mediasProduct.find((m: { url?: string, id: string, status: string }) => m.url === normalizedVariantImageUrl);
            if (matchingMedia && matchingMedia.status === 'READY') {
              attachMediaId = matchingMedia.id;
              readyStatus = true;
              break;
            }
            await new Promise(res => setTimeout(res, 1000));
          }

          if (!attachMediaId) {
            console.warn(`Aucun media READY pour image ${normalizedVariantImageUrl}`);
            continue;
          }

          const optionsKey = productOptions.map((opt, idx) =>
            row[`Option${idx + 1} Value`] ? row[`Option${idx + 1} Value`].trim().toLowerCase() : ''
          ).join('|');
          const variantMapping = allVariantIds.find((v: { variantId: string, optionsKey: string }) => v.optionsKey === optionsKey);

          if (variantMapping && readyStatus) {
            const result = await appendImageToVariant(shop, token, variantMapping.variantId, attachMediaId);
            console.log(`Image variante attachée: ${variantMapping.variantId} <- ${attachMediaId}`);
            console.log("AppendImageToVariant response:", JSON.stringify(result, null, 2));
            if (result?.data?.productVariantAppendMedia?.mediaUserErrors?.length) {
              console.warn('mediaUserErrors:', result.data.productVariantAppendMedia.mediaUserErrors);
            }
          } else {
            console.warn(`Aucune variante trouvée pour optionsKey=${optionsKey}`);
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
