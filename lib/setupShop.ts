import { parse } from "csv-parse/sync";

// Utilitaire pour normaliser le domaine des urls images
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Fonction PATCHÉE - workflow Shopify images moderne (productCreateMedia, productVariantAppendMedia)
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    // DELIMITER: correct pour ton CSV (;) !
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    // Regroupe les lignes du CSV par Handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
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

    // PATCH multi-images produit : Set, attacher toutes images uniques du groupe
    async function attachAllImagesToProduct(shop: string, token: string, productId: string, group: any[]) {
      const imagesToAttach = [
        ...new Set(group.map(row => row["Image Src"]).filter(Boolean))
      ];
      for (const imgUrl of imagesToAttach) {
        try {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          const resJson = await attachImageToProduct(shop, token, productId, normalizedUrl, "");
          const mediaId = resJson?.data?.productCreateMedia?.media?.[0]?.id;
          const imageUrl = resJson?.data?.productCreateMedia?.media?.[0]?.image?.url;
          if (mediaId && imageUrl) {
            console.log(`Image ajoutée au produit: ${productId} : ${imgUrl} mediaId=${mediaId}`);
          } else {
            console.error(`Erreur createMedia: ${JSON.stringify(resJson)}`);
          }
        } catch (err) {
          console.error(`Erreur upload/attach image produit ${productId}`, err);
        }
      }
    }

    // --- CREATION PRODUITS & VARIANTS PATCH ---
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];
      // Création mapping des options (Order, handle custom)
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
        // Création produit principal Shopify (old code fiable)
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
        const userErrors = gqlJson?.data?.productCreate?.userErrors ?? [];
        if (!productId) {
          console.error(
            "Aucun productId généré.",
            "userErrors:", userErrors.length > 0 ? userErrors : "Aucune erreur Shopify.",
            "Réponse brute:", JSON.stringify(gqlJson, null, 2)
          );
          continue;
        }
        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

        // Attacher toutes les images PRODUIT PATCH workflow ok
        await attachAllImagesToProduct(shop, token, productId, group);

        // --- Crée la liste de variants
        const seen = new Set<string>();
        const variants = group
          .map(row => {
            // Build option values
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
              console.log('Bulk variants response:', JSON.stringify(bulkJson, null, 2));
            }
          } catch (err) {
            console.error('Erreur bulk variants GraphQL', handleUnique, err);
          }
        }

        // PATCH: Attacher aux variants l'image correspondante du produit, si colonne Variant Image existe
        // 1. Crée toutes les images produit en media (récupère les mediaId)
        // 2. Pour chaque variant, regarde si quelque chose en Variant Image
        // 3. Si oui, attache l'image à la variante via productVariantAppendMedia
        const mediasToAppend: { url: string, id: string }[] = [];
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
        for (const edge of mediaEdges) {
          const url = edge?.node?.image?.url;
          const id = edge?.node?.id;
          if (url && id) mediasToAppend.push({ url, id });
        }

        // Récupère les variants créés
        const variantsRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              query getVariants($productId: ID!) {
                product(id: $productId) {
                  variants(first: 50) {
                    edges { node { id selectedOptions { value } } }
                  }
                }
              }
            `,
            variables: { productId }
          })
        });
        const variantsJson = await variantsRes.json();
        const variantEdges = variantsJson?.data?.product?.variants?.edges ?? [];
        for (const variantEdge of variantEdges) {
          const variant = variantEdge?.node;
          const optionValues = variant.selectedOptions?.map((opt: any) => opt.value).join(" ") ?? "";
          const csvRow = group.find(row =>
            productOptions.map((opt, idx) => row[`Option${idx + 1} Value`]).join(" ") === optionValues
          );
          if (csvRow && csvRow["Variant Image"]) {
            // Cherche si l'image Variant correspond déjà uploadée
            const normalizedVariantImageUrl = normalizeImageUrl(csvRow["Variant Image"]);
            let mediaId = mediasToAppend.find(m => m.url === normalizedVariantImageUrl)?.id;
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
                await attachImageToVariant(shop, token, variant.id, mediaId);
                console.log(`Image de variante attachée à ${variant.id}`);
              } catch (err) {
                console.error(`Erreur patch variant image media ${variant.id}`, err);
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
