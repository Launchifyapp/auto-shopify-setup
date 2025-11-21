import { parse } from "csv-parse/sync";
import { GraphqlClient } from "@shopify/shopify-api";

// Fonction pour créer la page Livraison via SDK Shopify
async function createLivraisonPageWithSDK(session: any) {
  const client = new GraphqlClient({ session });
  const query = `
    mutation CreatePage($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page {
          id
          title
          handle
        }
        userErrors { code field message }
      }
    }
  `;
  const livraisonVars = {
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
  };

  // Correction du typage de retour : le .body est le vrai résultat
  const response = await client.query({
    data: {
      query,
      variables: { page: livraisonVars },
    },
  });
  const data = response.body;
  if (data?.data?.pageCreate?.userErrors?.length) {
    console.error("Erreur création page Livraison:", data.data.pageCreate.userErrors);
  } else {
    console.log("Page Livraison créée :", data.data.pageCreate.page);
  }
}

function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

function extractCheckboxMetafields(row: any): any[] {
  const metafields: any[] = [];
  if (row["Checkbox 1 (product.metafields.custom.checkbox_1)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_1",
      type: "single_line_text_field",
      value: row["Checkbox 1 (product.metafields.custom.checkbox_1)"].toString()
    });
  }
  if (row["Checkbox 2 (product.metafields.custom.checkbox_2)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_2",
      type: "single_line_text_field",
      value: row["Checkbox 2 (product.metafields.custom.checkbox_2)"].toString()
    });
  }
  if (row["Checkbox 3 (product.metafields.custom.checkbox_3)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_3",
      type: "single_line_text_field",
      value: row["Checkbox 3 (product.metafields.custom.checkbox_3)"].toString()
    });
  }
  return metafields;
}

// Upload image en media produit Shopify (SDK GraphQL)
async function attachImageToProductWithSDK(session: any, productId: string, imageUrl: string, altText: string = ""): Promise<string | undefined> {
  const client = new GraphqlClient({ session });
  const query = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage { id image { url } }
        }
        mediaUserErrors { field message }
      }
    }
  `;
  const media = [{
    originalSource: imageUrl,
    mediaContentType: "IMAGE",
    alt: altText
  }];
  const response = await client.query({
    data: {
      query,
      variables: { productId, media }
    },
  });
  const data = response.body;
  return data?.data?.productCreateMedia?.media?.[0]?.id;
}

// Crée un produit avec une mutation GraphQL via SDK
async function createProductWithSDK(session: any, product: any) {
  const client = new GraphqlClient({ session });
  const query = `
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
  `;
  const response = await client.query({
    data: {
      query,
      variables: { product }
    }
  });
  const data = response.body;
  return data?.data?.productCreate;
}

// Création bulk des variantes via SDK
async function bulkCreateVariantsWithSDK(session: any, productId: string, variants: any[]) {
  const client = new GraphqlClient({ session });
  const query = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id sku price }
        userErrors { field message }
      }
    }
  `;
  const response = await client.query({
    data: {
      query,
      variables: { productId, variants },
    },
  });
  const data = response.body;
  return data?.data?.productVariantsBulkCreate;
}

// Update variant price via SDK
async function updateVariantPriceWithSDK(session: any, variantId: string, price: string, compareAtPrice?: string) {
  const client = new GraphqlClient({ session });
  const query = `
    mutation productVariantUpdate($id: ID!, $price: Money!, $compareAtPrice: Money) {
      productVariantUpdate(id: $id, price: $price, compareAtPrice: $compareAtPrice) {
        productVariant { id price compareAtPrice }
        userErrors { field message }
      }
    }
  `;
  const variables: any = { id: variantId, price };
  if (compareAtPrice !== undefined) {
    variables.compareAtPrice = compareAtPrice;
  }
  await client.query({
    data: {
      query,
      variables,
    },
  });
}

// Fonction principale utilisant UNIQUEMENT le SDK Shopify
export async function setupShop({ session }: { session: any }) {
  try {
    // Crée la page Livraison via le SDK
    await createLivraisonPageWithSDK(session);

    // Import et création des produits depuis le CSV
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    // Regroupement des produits par handle
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
              .filter(v => !!v && v !== "Default Title"))
          ].map(v => ({ name: v }));
          if (optionValues.length) {
            productOptions.push({ name: optionName, values: optionValues });
          }
        }
      }
      const productOptionsOrUndefined = productOptions.length ? productOptions : undefined;
      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

      const productMetafields = extractCheckboxMetafields(main);

      // Construction du payload produit
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
        // Création du produit via SDK
        const productCreateData = await createProductWithSDK(session, product);
        const productData = productCreateData?.product;
        const productId = productData?.id;
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(productCreateData, null, 2));
          continue;
        }
        console.log("Product créé avec id:", productId);

        // Upload des images via SDK
        const allImagesToAttach = [
          ...new Set([
            ...group.map(row => row["Image Src"]).filter(Boolean),
            ...group.map(row => row["Variant Image"]).filter(Boolean),
          ])
        ];
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          await attachImageToProductWithSDK(session, productId, normalizedUrl, "");
        }

        // Création des variantes supplémentaires
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
            };
          })
          .filter(v => v && v.optionValues && v.optionValues.length);

        let allVariantIds: string[] = [];
        if (variants.length > 1) { // bulk/create SDK
          const bulkData = await bulkCreateVariantsWithSDK(session, productId, variants.slice(1));
          if (bulkData?.productVariants) {
            allVariantIds = bulkData.productVariants.map((v: { id: string }) => v.id);
          }
        }

        // Ajoute les variantes de la création du produit (toujours présentes dans productData.variants.edges)
        if (productData?.variants?.edges) {
          allVariantIds = [
            ...allVariantIds,
            ...productData.variants.edges.map((edge: { node: { id: string } }) => edge.node.id)
          ];
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
