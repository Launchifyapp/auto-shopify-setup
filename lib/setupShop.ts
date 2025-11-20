import { parse } from "csv-parse/sync";

// Utilitaire pour normaliser le domaine des urls images
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Attache une image à un produit (productCreateMedia)
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

// Attache un media à une variante (productVariantAppendMedia)
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
  return await res.json();
}

// Récupère tous les media du produit
async function getProductMedia(shop: string, token: string, productId: string) {
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
  return json?.data?.product?.media?.edges?.map(edge => ({
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

    // Regroupement par Handle
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // --- CREATION PRODUITS & VARIANTS & PATCH IMAGE VARIANTS ---
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
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(gqlJson, null, 2));
          continue;
        }
        const productVariants = productData?.variants?.edges ?? [];
        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

        // 2. Attacher toutes les images PRODUIT (multi-images patch)
        const imagesToAttach = [
          ...new Set(group.map(row => row["Image Src"]).filter(Boolean))
        ];
        for (const imgUrl of imagesToAttach) {
          try {
            const normalizedUrl = normalizeImageUrl(imgUrl);
            const mediaRes = await attachImageToProduct(shop, token, productId, normalizedUrl, "");
            const createdMediaId = mediaRes?.data?.productCreateMedia?.media?.[0]?.id;
            console.log(`Image ajoutée au produit: ${productId} : ${imgUrl} | mediaId=${createdMediaId}`);
          } catch (err) { console.error(`Erreur upload/attach image produit ${productId} | ${imgUrl}`, err); }
        }

        // 3. PATCH image variante via productVariantAppendMedia
        // a. Récupérer tous les media pour ce produit
        const medias = await getProductMedia(shop, token, productId);

        // b. Pour chaque variante créée, attacher image si CSV la propose
        for (const v of productVariants) {
          const variantId = v.node?.id;
          if (!variantId) continue;
          // Recompose options pour matching (join avec séparateur pour robustesse)
          const createdSelectedOpt = (v.node.selectedOptions ?? []).map((opt: any) => opt.value).join("|");

          // Retrouver la ligne CSV correspondante
          const csvRow = group.find(row =>
            productOptions.map((opt, idx) => row[`Option${idx + 1} Value`]?.trim()).filter(Boolean).join("|") === createdSelectedOpt
          );
          if (csvRow?.["Variant Image"]) {
            const normalizedVariantImageUrl = normalizeImageUrl(csvRow["Variant Image"]);
            let mediaId = medias.find(m => m.url === normalizedVariantImageUrl)?.id;

            // Si l'image de la variante n'est pas déjà un media, upload-la
            if (!mediaId) {
              try {
                const mediaRes = await attachImageToProduct(shop, token, productId, normalizedVariantImageUrl, "");
                mediaId = mediaRes?.data?.productCreateMedia?.media?.[0]?.id || undefined;
                if (mediaId) medias.push({ url: normalizedVariantImageUrl, id: mediaId });
                else console.error(`Erreur création media pour image variant: ${normalizedVariantImageUrl}`);
              } catch (err) { console.error(`Erreur attach/mapping media image variant`, err); }
            }
            // Attache le mediaId à la variante
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
