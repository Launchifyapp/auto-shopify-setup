import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";

// Création de la page Livraison
async function createLivraisonPageWithSDK(session: Session) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation CreatePage($input: PageCreateInput!) {
      pageCreate(page: $input) {
        page { id title handle }
        userErrors { code field message }
      }
    }
  `;
  const variables = { input: {
    title: "Livraison",
    handle: "livraison",
    body: `Livraison GRATUITE
Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:
France : 4-10 jours ouvrables
Belgique: 4-10 jours ouvrables
Suisse : 7-12 jours ouvrables
Canada : 7-12 jours ouvrables
Reste du monde : 7-14 jours
`,
    isPublished: true,
    templateSuffix: "custom"
  }};
  const response: any = await client.request(query, { variables });
  if (response?.data?.pageCreate?.userErrors?.length) {
    console.error("Erreur création page Livraison:", response.data.pageCreate.userErrors);
  } else {
    console.log("Page Livraison créée :", response.data.pageCreate.page);
  }
}

function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

function extractCheckboxMetafields(row: any): any[] {
  const metafields: any[] = [];
  if (row["Checkbox 1 (product.metafields.custom.checkbox_1)"] !== undefined) {
    metafields.push({ namespace: "custom", key: "checkbox_1", type: "single_line_text_field", value: row["Checkbox 1 (product.metafields.custom.checkbox_1)"].toString() });
  }
  if (row["Checkbox 2 (product.metafields.custom.checkbox_2)"] !== undefined) {
    metafields.push({ namespace: "custom", key: "checkbox_2", type: "single_line_text_field", value: row["Checkbox 2 (product.metafields.custom.checkbox_2)"].toString() });
  }
  if (row["Checkbox 3 (product.metafields.custom.checkbox_3)"] !== undefined) {
    metafields.push({ namespace: "custom", key: "checkbox_3", type: "single_line_text_field", value: row["Checkbox 3 (product.metafields.custom.checkbox_3)"].toString() });
  }
  return metafields;
}

// Mutation batch pour rattacher plusieurs images à variants
async function appendMediaToVariantsBatch(session: Session, productId: string, variantMedia: any[]) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
      productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
        productVariants {
          id
          media(first: 10) {
            edges { node { ... on MediaImage { id preview { image { url } } } } }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const variables = { productId, variantMedia };
  const response: any = await client.request(query, { variables });
  if (response?.data?.productVariantAppendMedia?.userErrors?.length) {
    console.error("Erreur batch rattachement media à variantes :", response.data.productVariantAppendMedia.userErrors);
  }
  return response?.data?.productVariantAppendMedia?.productVariants;
}

// Maj variante par défaut via productVariantsBulkUpdate
async function updateDefaultVariantWithSDK(session: Session, productId: string, variantId: string, main: any) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price compareAtPrice sku barcode }
        userErrors { field message }
      }
    }
  `;
  const variant: any = {
    id: variantId,
    price: main["Variant Price"] ?? "0",
    ...(main["Variant Compare At Price"] ? { compareAtPrice: main["Variant Compare At Price"] } : {}),
    ...(main["Variant SKU"] ? { sku: main["Variant SKU"] } : {}),
    ...(main["Variant Barcode"] ? { barcode: main["Variant Barcode"] } : {}),
  };
  const variables = { productId, variants: [variant] };
  const response: any = await client.request(query, { variables });
  const data = response?.data?.productVariantsBulkUpdate;
  if (data?.userErrors?.length) {
    console.error("Erreur maj variante (bulkUpdate):", data.userErrors);
  } else {
    console.log("Variante maj (bulkUpdate):", data.productVariants?.[0]);
  }
  return data?.productVariants?.[0]?.id;
}

// Bulk create variants via Shopify API
async function bulkCreateVariantsWithSDK(session: Session, productId: string, variants: any[]) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id price sku barcode compareAtPrice }
        userErrors { field message }
      }
    }
  `;
  const variables = { productId, variants };
  const response: any = await client.request(query, { variables });
  const data = response;
  return data?.data?.productVariantsBulkCreate;
}

// Crée un produit via Shopify API
async function createProductWithSDK(session: Session, product: any) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productCreate($input: ProductCreateInput!) {
      productCreate(product: $input) {
        product {
          id
          handle
          media(first: 50) {
            edges { node { ... on MediaImage { id image { url } } } }
          }
          variants(first: 50) {
            edges { node { id sku title selectedOptions { name value } price compareAtPrice barcode } }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const variables = { input: product };
  const response: any = await client.request(query, { variables });
  return response?.data?.productCreate;
}

export async function setupShop({ session }: { session: Session }) {
  try {
    await createLivraisonPageWithSDK(session);

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

      // Build product options array
      type ProductOption = { name: string, values: { name: string }[] };
      const productOptions: ProductOption[] = [];
      for (let i = 1; i <= 3; i++) {
        const optionName = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
        if (optionName) {
          const optionValues = [...new Set(group.map(row => (row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : "")).filter(v => !!v && v !== "Default Title"))].map(v => ({ name: v }));
          if (optionValues.length) productOptions.push({ name: optionName, values: optionValues });
        }
      }
      const productOptionsOrUndefined = productOptions.length ? productOptions : undefined;
      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

      const productMetafields = extractCheckboxMetafields(main);

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

      try {
        const productCreateData = await createProductWithSDK(session, product);
        const productData = productCreateData?.product;
        const productId = productData?.id;
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(productCreateData, null, 2));
          continue;
        }
        console.log("Product créé avec id:", productId);

        // Upload images produit (hors variantes) déjà géré par Shopify via Image Src au moment de la création

        // Produit AVEC ou SANS options/variantes
        const mediaEdges = productData.media?.edges ?? [];
        const variantEdges = productData.variants?.edges ?? [];

        // Création mapping "url normale" -> mediaId
        const mediaMap: Record<string, string> = {};
        mediaEdges.forEach((edge: any) => {
          if (edge.node && edge.node.image && edge.node.image.url) {
            const url = normalizeImageUrl(edge.node.image.url);
            mediaMap[url] = edge.node.id;
          }
        });

        // Mapping clé d’options → variantId Shopify
        const variantIdMap: Record<string, string> = {};
        variantEdges.forEach((edge: any) => {
          const optionsKey = (edge.node.selectedOptions || [])
            .map((o: any) => o.value.trim())
            .join('|');
          variantIdMap[optionsKey] = edge.node.id;
        });

        // Construction du batch mapping image-variant (pas d'upload, tout est déjà en galerie)
        const variantMedia: any[] = [];
        for (const row of group) {
          const variantImageUrl = row["Variant Image"];
          if (variantImageUrl && variantImageUrl.trim() && variantImageUrl !== "nan" && variantImageUrl !== "null" && variantImageUrl !== "undefined") {
            const normalizedUrl = normalizeImageUrl(variantImageUrl);
            const mediaId = mediaMap[normalizedUrl];
            const optionsKey = [1,2,3]
              .map(i => row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : '')
              .filter(Boolean)
              .join('|');
            const variantId = variantIdMap[optionsKey];
            if (variantId && mediaId) {
              variantMedia.push({
                variantId,
                mediaIds: [mediaId]
              });
            }
          }
        }

        // batch attach images aux variants
        if (variantMedia.length > 0) {
          await appendMediaToVariantsBatch(session, productId, variantMedia);
        }

        // Bulk create variants et update variantes par défaut restent identiques, si besoin en complément :
        if (productOptionsOrUndefined && productOptionsOrUndefined.length > 0) {
          // Bulk create, skip 1ère variante déjà existante
          const seen = new Set<string>();
          const variants = group
            .map((row, idx) => {
              const optionValues: { name: string; optionName: string }[] = [];
              productOptions.forEach((opt, optIdx) => {
                const value = row[`Option${optIdx + 1} Value`] && row[`Option${optIdx + 1} Value`].trim();
                if (value && value !== "Default Title") optionValues.push({ name: value, optionName: opt.name });
              });
              const key = optionValues.map(ov => ov.name).join("|");
              if (seen.has(key)) return undefined;
              seen.add(key);
              if (!optionValues.length) return undefined;
              const variant: any = {
                price: row["Variant Price"] || main["Variant Price"] || "0",
                optionValues,
              };
              if (row["Variant SKU"]) variant.sku = row["Variant SKU"];
              if (row["Variant Barcode"]) variant.barcode = row["Variant Barcode"];
              if (row["Variant Compare At Price"]) variant.compareAtPrice = row["Variant Compare At Price"];
              return variant;
            })
            .filter(v => v && v.optionValues && v.optionValues.length);

          if (variants.length > 1) {
            await bulkCreateVariantsWithSDK(session, productId, variants.slice(1));
          }

          // update la première variante Shopify
          if (variantEdges.length) {
            const firstVariantId = variantEdges[0].node.id;
            await updateDefaultVariantWithSDK(session, productId, firstVariantId, group[0]);
          }
        }
        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.error("Erreur création produit GraphQL", handleUnique, err);
      }
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
