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
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    // Regroupe les lignes du CSV par Handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // Shopify GraphQL 2025-10+ : Attache une image à un produit
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

    // Shopify : Attache mediaId à une variante
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

    // --- CREATION PRODUIT & VARIANTS ---
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
        // 1. Création du produit principal avec toutes les variantes/options
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

        // 2. Attacher toutes les images PRODUIT (structure multi-images)
        await attachAllImagesToProduct(shop, token, productId, group);

        // 3. Récupère les variants créés lors du productCreate
        const variantsCreated =
          productData?.variants?.edges?.map((edge: any) => ({
            id: edge.node?.id,
            selectedOptions:
              edge.node?.selectedOptions?.map((opt: any) => opt.value).join("|"),
          })) ?? [];

        // PATCH: Attacher images à chaque variante existante si colonne "Variant Image" existe
        // Media images déjà uploadées au produit pour le mapping rapide
        // 1. On get le mediaIds déjà rattachés au produit
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

        // PATCH: Pour chaque variant, attache image si Variant Image existe et si ce mediaId existe (sinon, upload + append)
        for (const v of variantsCreated) {
          // Retrouve la CSV row par mapping options
          const csvRow = group.find(row =>
            productOptions
              .map((opt, idx) => row[`Option${idx + 1} Value`]?.trim())
              .filter(Boolean)
              .join("|") === v.selectedOptions
          );
          if (csvRow && csvRow["Variant Image"] && v.id) {
            const normalizedVariantImageUrl = normalizeImageUrl(csvRow["Variant Image"]);
            let mediaId = mediasToAppend.find(m => m.url === normalizedVariantImageUrl)?.id;
            // Upload si pas déjà là
            if (!mediaId) {
              try {
                const resJson = await attachImageToProduct(shop, token, productId, normalizedVariantImageUrl, "");
                mediaId = resJson?.data?.productCreateMedia?.media?.[0]?.id;
                if (mediaId) mediasToAppend.push({ url: normalizedVariantImageUrl, id: mediaId });
                else console.error(`Erreur attach image variant: ${JSON.stringify(resJson)}`);
              } catch (err) { console.error(`Erreur attach/mapping media image variant`, err); }
            }
            if (mediaId) {
              try {
                await attachImageToVariant(shop, token, v.id, mediaId);
                console.log(`Image de variante attachée à ${v.id}`);
              } catch (err) {
                console.error(`Erreur patch variant image media ${v.id}`, err);
              }
            }
          }
        }
        // 4. Optionnel : Patch supplémentaire sur variant existant (SKU, prix, etc.) via productVariantsBulkUpdate
        // (Pas appelé par défaut ici, à ajouter selon besoin)

        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.error('Erreur création produit GraphQL', handleUnique, err);
      }
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
