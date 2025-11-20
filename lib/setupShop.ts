import { parse } from "csv-parse/sync";

// Utilitaire pour normaliser le domaine des urls images
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Mutation pour attacher une image au produit (Shopify v2025-10+)
async function attachImageToProduct(shop: string, token: string, productId: string, imageUrl: string, altText: string = "") {
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
  return await res.json();
}

// Mutation pour attacher une image media à une variante
async function attachImageToVariant(shop: string, token: string, variantId: string, mediaId: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantAppendMedia($variantId: ID!, $mediaIds: [ID!]!) {
          productVariantAppendMedia(variantId: $variantId, mediaIds: $mediaIds) {
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
      variables: { variantId, mediaIds: [mediaId] }
    })
  });
  return await res.json();
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

    // --- CREATION PRODUITS & VARIANTS PATCH ---
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
          console.error(
            "Aucun productId généré.",
            "Réponse brute:", JSON.stringify(gqlJson, null, 2)
          );
          continue;
        }
        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

        // Attacher toutes les images PRODUIT (multi-images PATCH)
        const imagesToAttach = [
          ...new Set(group.map(row => row["Image Src"]).filter(Boolean))
        ];
        for (const imgUrl of imagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          await attachImageToProduct(shop, token, productId, normalizedUrl, "");
        }

        // --- Crée la liste de variants
        const seen = new Set<string>();
        const variants = group
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

        // Bulk create variants en respectant le workflow (créé la première via productCreate, les suivantes en bulk)
        let bulkCreatedVariants: any[] = [];
        if (variants.length > 1) {
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
                variables: { productId, variants: variants.slice(1) },
              }),
            });
            const bulkJson = await bulkRes.json();
            if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
              console.error('Bulk variants userErrors:', bulkJson.data.productVariantsBulkCreate.userErrors);
            } else {
              bulkCreatedVariants = bulkJson?.data?.productVariantsBulkCreate?.productVariants ?? [];
              console.log('Bulk variants response:', JSON.stringify(bulkJson, null, 2));
            }
          } catch (err) {
            console.error('Erreur bulk variants GraphQL', handleUnique, err);
          }
        }

        // PATCH: Attacher aux variants l'image via productVariantAppendMedia
        const imagesRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              query getMedia($productId: ID!) {
                product(id: $productId) {
                  media(first:20) {
                    edges { node { ... on MediaImage { id image { url } } } }
                  }
                }
              }
            `,
            variables: { productId }
          })
        });
        const imagesJson = await imagesRes.json();
        const mediaEdges = imagesJson?.data?.product?.media?.edges ?? [];
        const mediasToAppend: { url: string, id: string }[] = [];
        for (const edge of mediaEdges) {
          const url = edge?.node?.image?.url;
          const id = edge?.node?.id;
          if (url && id) mediasToAppend.push({ url, id });
        }

        // Récupère toutes les variants créées (productCreate + bulk)
        const variantIds: { variantId: string, optValues: string }[] = [];
        // ProductCreate variants
        const productVariantsCreated = productData?.variants?.edges ?? [];
        for (const v of productVariantsCreated) {
          variantIds.push({
            variantId: v.node?.id,
            optValues: (v.node?.selectedOptions ?? []).map((opt: any) => opt.value).join(' ')
          });
        }
        // Bulk variants
        for (const v of bulkCreatedVariants) {
          // BulkCreate does not return selectedOptions, so we need to recompute optValues from CSV group
          // We'll map by SKU if present (or price if not), or recompute mapping
          // For safety, do fuzzy match
          variantIds.push({
            variantId: v.id,
            optValues: '' // Will map later
          });
        }

        // Attacher images aux variants
        for (const variantObj of variantIds) {
          const variantId = variantObj.variantId;
          if (!variantId) continue;

          // FIND CSV line that matches this variant
          // For variants from productCreate : use selectedOptions mapping
          let csvRow;
          if (variantObj.optValues) {
            csvRow = group.find(row =>
              productOptions.map((opt, idx) => row[`Option${idx + 1} Value`]?.trim()).filter(Boolean).join(' ') === variantObj.optValues
            );
          } else if (variantId) {
            // For bulk variants: fallback matching by SKU if present
            csvRow = group.find(row =>
              (row["Variant SKU"] && row["Variant SKU"] === variantId) // highly unlikely, fallback only
            );
          }
          if (csvRow && csvRow["Variant Image"]) {
            const normalizedVariantImageUrl = normalizeImageUrl(csvRow["Variant Image"]);
            let mediaId = mediasToAppend.find((m: { url: string, id: string }) => m.url === normalizedVariantImageUrl)?.id;
            // Sinon, upload + attach en tant que media produit -> Récupère mediaId
            if (!mediaId) {
              try {
                const resJson = await attachImageToProduct(shop, token, productId, normalizedVariantImageUrl, "");
                mediaId = resJson?.data?.productCreateMedia?.media?.[0]?.id;
                if (mediaId) mediasToAppend.push({ url: normalizedVariantImageUrl, id: mediaId });
                else console.error(`Erreur attach image variant: ${JSON.stringify(resJson)}`);
              } catch (err) { console.error(`Erreur attach/mapping media image variant`, err); }
            }
            // Si mediaId dispo, patch la variante
            if (mediaId) {
              try {
                await attachImageToVariant(shop, token, variantId, mediaId);
                console.log(`Image de variante attachée à ${variantId}`);
              } catch (err) {
                console.error(`Erreur patch variant image media ${variantId}`, err);
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
