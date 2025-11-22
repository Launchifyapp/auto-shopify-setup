import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";

// Fonction pour créer la page Livraison via Shopify API
async function createLivraisonPageWithSDK(session: Session) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation CreatePage($input: PageCreateInput!) {
      pageCreate(page: $input) {
        page {
          id
          title
          handle
        }
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
  const data = response;
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
async function attachImageToProductWithSDK(session: Session, productId: string, imageUrl: string, altText: string = ""): Promise<string | undefined> {
  const client = new shopify.clients.Graphql({ session });
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
  const variables = { productId, media: [{
    originalSource: imageUrl,
    mediaContentType: "IMAGE",
    alt: altText
  }]};

  const response: any = await client.request(query, { variables });
  const data = response;
  return data?.data?.productCreateMedia?.media?.[0]?.id;
}

// Crée un produit avec une mutation GraphQL via Shopify API
async function createProductWithSDK(session: Session, product: any) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productCreate($input: ProductCreateInput!) {
      productCreate(product: $input) {
        product {
          id
          handle
          variants(first: 50) {
            edges { node { id sku title selectedOptions { name value } price compareAtPrice } }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const variables = { input: product };
  const response: any = await client.request(query, { variables });
  const data = response;
  return data?.data?.productCreate;
}

// Crée la première variante pour un produit sans variantes : utilise productVariantsBulkCreate !
async function createFirstVariantWithBulkCreate(session: Session, productId: string, main: any) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id price sku }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    productId,
    variants: [
      {
        price: main["Variant Price"] ?? "0",
        compareAtPrice: main["Variant Compare At Price"] ?? undefined,
        sku: main["Variant SKU"] ?? undefined,
        barcode: main["Variant Barcode"] ?? undefined,
        optionValues: [
          {
            name: "Default Title",
            optionName: "Title",
          }
        ],
      }
    ]
  };
  const response: any = await client.request(query, { variables });
  const data = response;
  if (data?.data?.productVariantsBulkCreate?.userErrors?.length) {
    console.error("Erreur création variante par bulkCreate:", data.data.productVariantsBulkCreate.userErrors);
  } else {
    console.log("Variante créée (bulkCreate) :", data.data.productVariantsBulkCreate.productVariants?.[0]);
  }
  return data?.data?.productVariantsBulkCreate?.productVariants?.[0]?.id;
}

// Création bulk des variantes via Shopify API (pour produits avec options)
async function bulkCreateVariantsWithSDK(session: Session, productId: string, variants: any[]) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id sku price }
        userErrors { field message }
      }
    }
  `;
  const variables = { productId, variants };
  const response: any = await client.request(query, { variables });
  const data = response;
  return data?.data?.productVariantsBulkCreate;
}

// Update variant price via Shopify API
async function updateVariantPriceWithSDK(session: Session, variantId: string, price: string, compareAtPrice?: string) {
  const client = new shopify.clients.Graphql({ session });
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
  await client.request(query, { variables });
}

// Fonction principale utilisant UNIQUEMENT le SDK Shopify
export async function setupShop({ session }: { session: Session }) {
  try {
    // Crée la page Livraison via Shopify API
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
        // Création du produit via Shopify API (SANS variants!)
        const productCreateData = await createProductWithSDK(session, product);
        const productData = productCreateData?.product;
        const productId = productData?.id;
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(productCreateData, null, 2));
          continue;
        }
        console.log("Product créé avec id:", productId);

        // Upload des images via Shopify API
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

        // PATCH : S'il n'y a PAS d'options/variantes, on crée la variante par défaut via bulkCreate avec option default !
        if (!productOptionsOrUndefined || productOptionsOrUndefined.length === 0) {
          await createFirstVariantWithBulkCreate(session, productId, main);
        }

        // PATCH : Création bulk des variantes - seulement si produit AVEC options
        let allVariantIds: string[] = [];
        if (productOptionsOrUndefined && productOptionsOrUndefined.length > 0) {
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

          if (variants.length > 1) {
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
