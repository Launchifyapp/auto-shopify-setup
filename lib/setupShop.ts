import { parse } from "csv-parse/sync";

// Utilitaire pour normaliser le domaine des urls images
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Ajoute ou met à jour les metafields Shopify pour un produit
async function updateProductMetafields(shop: string, token: string, productId: string, metafields: any[]) {
  if (!metafields || metafields.length === 0) return;
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation metafieldsSet($ownerId: ID!, $metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(ownerId: $ownerId, metafields: $metafields) {
            metafields { id namespace key value type }
            userErrors { field message }
          }
        }
      `,
      variables: { ownerId: productId, metafields }
    })
  });
  const json = await res.json();
  if (json.data?.metafieldsSet?.userErrors?.length) {
    console.warn('Metafields userErrors:', JSON.stringify(json.data.metafieldsSet.userErrors));
  } else {
    console.log(`Metafields ajoutés au produit ${productId}:`, JSON.stringify(json.data?.metafieldsSet?.metafields));
  }
}

// Attache une image en tant que media produit (retourne l'id du media créé)
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

// Attache un media à une variante
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

// Utilitaire pour extraire tous les metafields Checkbox du CSV
function extractCheckboxMetafields(row: any): any[] {
  const metafields: any[] = [];
  // Checkbox 1
  if (row["Checkbox 1"] != null && row["Checkbox 1"].trim() !== "") {
    metafields.push({
      namespace: "custom",
      key: "checkbox_1",
      type: "boolean",
      value: ["1", "true", "TRUE", "oui", "yes", "vrai", "on"].includes(row["Checkbox 1"].toLowerCase().trim())
        ? "true"
        : "false"
    });
  }
  // Checkbox 2
  if (row["Checkbox 2"] != null && row["Checkbox 2"].trim() !== "") {
    metafields.push({
      namespace: "custom",
      key: "checkbox_2",
      type: "boolean",
      value: ["1", "true", "TRUE", "oui", "yes", "vrai", "on"].includes(row["Checkbox 2"].toLowerCase().trim())
        ? "true"
        : "false"
    });
  }
  // Checkbox 3
  if (row["Checkbox 3"] != null && row["Checkbox 3"].trim() !== "") {
    metafields.push({
      namespace: "custom",
      key: "checkbox_3",
      type: "boolean",
      value: ["1", "true", "TRUE", "oui", "yes", "vrai", "on"].includes(row["Checkbox 3"].toLowerCase().trim())
        ? "true"
        : "false"
    });
  }
  return metafields;
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
        // Création du produit principal Shopify
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

        // Ajout des metafields dès la création du produit
        const productMetafields = extractCheckboxMetafields(main);
        if (productMetafields.length > 0) {
          await updateProductMetafields(shop, token, productId, productMetafields);
        }

        // Upload toutes les images (Image Src + Variant Image)
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

        // Crée variantes supplémentaires si nécessaire
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

        let allVariantIds: string[] = [];
        // Bulk create (variants en plus)
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
          if (bulkJson?.data?.productVariantsBulkCreate?.productVariants) {
            allVariantIds = bulkJson.data.productVariantsBulkCreate.productVariants.map((v: { id: string }) => v.id);
          }
        }

        // Ajoute les variantes de la création du produit (toujours présente dans productData.variants.edges)
        if (productData?.variants?.edges) {
          allVariantIds = [
            ...allVariantIds,
            ...productData.variants.edges.map((edge: { node: { id: string } }) => edge.node.id)
          ];
        }

        // Après bulkCreate, rattacher l'image à chaque variante si Variant Image existe
        for (const row of group) {
          const variantImageUrl = row["Variant Image"];
          if (!variantImageUrl) continue;
          const normalizedVariantImageUrl = normalizeImageUrl(variantImageUrl);
          const mediaId = mediaMap[normalizedVariantImageUrl];
          if (!mediaId) {
            console.error(`Media non trouvé pour image variante: ${normalizedVariantImageUrl}`);
            continue;
          }
          const optionsKey = productOptions.map((opt, idx) => row[`Option${idx + 1} Value`] ? row[`Option${idx + 1} Value`].trim() : '').join('|');
          const variantId = allVariantIds.find((vid) => true);
          if (variantId) {
            await attachImageToVariant(shop, token, variantId, mediaId);
            console.log(`Image variante attachée: ${variantId} <- ${mediaId}`);
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
