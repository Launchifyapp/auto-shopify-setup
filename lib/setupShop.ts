import { parse } from "csv-parse/sync";

// Normalise les URLs d'images
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Poll le status des médias jusqu'à READY ou timeout
async function pollMediaReady(shop: string, token: string, productId: string, imageUrl: string, maxRetries = 30, delayMs = 2000): Promise<string | undefined> {
  for (let retry = 0; retry < maxRetries; retry++) {
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
    const medias = json?.data?.product?.media?.edges ?? [];
    for (const edge of medias) {
      const n = edge.node;
      if (n.image?.url === imageUrl && n.status === "READY") return n.id;
    }
    await new Promise(res => setTimeout(res, delayMs));
  }
  return undefined;
}

// Upload image en tant que media produit Shopify
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
  const mediaData = json?.data?.productCreateMedia?.media?.[0];
  if (mediaData?.id) {
    console.log(`[Upload] Media uploaded: id=${mediaData.id} url=${imageUrl} status=${mediaData.status}`);
    return mediaData.id;
  } else {
    console.warn(`[Upload] Media not uploaded for url=${imageUrl}:`, JSON.stringify(json, null, 2));
    return undefined;
  }
}

// Ajoute un media READY à une variante et log response
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

    // Regroupe les lignes du CSV par Handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      // Build product options
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
        // Création du produit principal + premières variantes/options
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

        // 1. Upload toutes les images nécessaires du groupe
        const allImagesToAttach = [
          ...new Set([
            ...group.filter(row => row["Image Src"]).map(row => row["Image Src"]),
            ...group.filter(row => row["Variant Image"]).map(row => row["Variant Image"])
          ])
        ];
        const mediaMap: Record<string, string> = {};
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          const mediaId = await attachImageToProduct(shop, token, productId, normalizedUrl, "");
          // Poll READY
          let readyId: string | undefined = undefined;
          if (mediaId) {
            readyId = await pollMediaReady(shop, token, productId, normalizedUrl, 30, 2000);
            if (readyId) mediaMap[normalizedUrl] = readyId;
            else console.warn(`[Polling] Media never READY: ${normalizedUrl}`);
          }
        }

        // 2. Création des variantes supplémentaires (bulk)
        const seen = new Set<string>();
        const variants = group
          .filter(row => row["Option1 Value"]) // ignore ligne uniquement media produit
          .map(row => {
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
              variables: { productId, variants: variants.slice(1) },
            }),
          });
          const bulkJson = await bulkRes.json();
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            console.warn("Bulk variants userErrors:", JSON.stringify(bulkJson.data.productVariantsBulkCreate.userErrors));
          }
        }

        // 3. Query : toutes les variantes créées (avec leurs key d'options)
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

        // Log mapping debug
        console.log("=== Shopify VARIANT optionsKey mapping ===");
        for (const v of allVariantIds) {
          console.log(`optionsKey: "${v.optionsKey}" => variantId: ${v.variantId}`);
        }

        // 4. Mapping et rattachement des images variantes
        for (const row of group.filter(row => row["Option1 Value"] && row["Variant Image"])) {
          const normalizedVariantImageUrl = normalizeImageUrl(row["Variant Image"]);
          const mediaId = mediaMap[normalizedVariantImageUrl];
          const optionsKey = productOptions.map((opt, idx) =>
            row[`Option${idx + 1} Value`] ? row[`Option${idx + 1} Value`].trim().toLowerCase() : ''
          ).join('|');
          const variantMapping = allVariantIds.find((v: { variantId: string, optionsKey: string }) => v.optionsKey === optionsKey);
          if (variantMapping && mediaId) {
            const result = await appendImageToVariant(shop, token, variantMapping.variantId, mediaId);
            console.log(`Image variante attachée: ${variantMapping.variantId} <- ${mediaId}`);
            console.log("AppendImageToVariant response:", JSON.stringify(result, null, 2));
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
