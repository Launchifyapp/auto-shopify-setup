import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";

// Fonction: récupère l'ID et le titre du menu principal par handle "main-menu"
async function getMainMenuIdAndTitle(session: Session): Promise<{id: string, title: string} | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query GetMenus {
      menus(first: 10) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.menus?.edges ?? [];
  // Recherche menu avec handle 'main-menu'
  const mainMenu = edges.find((e: any) => e.node.handle === "main-menu");
  if (mainMenu) return {id: mainMenu.node.id, title: mainMenu.node.title};
  // Si aucun handle 'main-menu', prend le premier
  if (edges.length) return {id: edges[0].node.id, title: edges[0].node.title};
  return null;
}

// Fonction: update du menu principal (main menu) – title requis !
async function updateMainMenu(session: Session, menuId: string, menuTitle: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation UpdateMenu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(
        id: $id,
        title: $title,
        items: $items
      ) {
        menu {
          id
          title
          items {
            title
            destination
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const items = [
    {
      title: "Accueil",
      type: "HOME",
      destination: "/"
    },
    {
      title: "Nos Produits",
      type: "COLLECTION",
      destination: "/collections/all"
    },
    {
      title: "Livraison",
      type: "PAGE",
      destination: "/pages/livraison"
    },
    {
      title: "Contact",
      type: "PAGE",
      destination: "/pages/contact"
    }
    // Ajoute d'autres liens si besoin
  ];
  const variables = {
    id: menuId,
    title: menuTitle, // requis par Shopify !
    items
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.menuUpdate?.userErrors?.length) {
    console.error("Erreur menuUpdate:", response.data.menuUpdate.userErrors);
  } else {
    console.log("[Menu principal] Mis à jour :", response.data.menuUpdate.menu);
  }
}

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

// Upload image comme média du produit
async function createProductMedia(session: Session, productId: string, imageUrl: string, altText: string = ""): Promise<string | undefined> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage { id image { url } status }
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
  return response?.data?.productCreateMedia?.media?.[0]?.id;
}

// PATCH: get media status from product.media via productId
async function getProductMediaStatus(session: Session, productId: string, mediaId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query getProductMedia($id: ID!) {
      product(id: $id) {
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
  `;
  const response: any = await client.request(query, { variables: { id: productId } });
  const edges = response?.data?.product?.media?.edges ?? [];
  const node = edges.find((e: any) => e?.node?.id === mediaId)?.node;
  return node ? node.status : undefined;
}

// Poll: attente que le media soit READY en utilisant getProductMediaStatus
async function waitForMediaReady(session: Session, productId: string, mediaId: string, timeoutMs = 15000) {
  const start = Date.now();
  while (true) {
    const status = await getProductMediaStatus(session, productId, mediaId);
    if (status === "READY") return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(res => setTimeout(res, 1500));
  }
}

// Rattache le média uploadé à la variante via productVariantAppendMedia (mediaIds en tableau)
async function appendMediaToVariant(session: Session, productId: string, variantId: string, mediaId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
      productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
        product { id }
        productVariants {
          id
          media(first: 10) {
            edges {
              node {
                mediaContentType
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
        userErrors { code field message }
      }
    }
  `;
  const variables = {
    productId,
    variantMedia: [
      {
        variantId,
        mediaIds: [mediaId]
      }
    ],
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.productVariantAppendMedia?.userErrors?.length) {
    console.error("Erreur rattachement media à variante :", response.data.productVariantAppendMedia.userErrors);
  }
  return response?.data?.productVariantAppendMedia?.productVariants;
}

// Met à jour la variante d'un produit via productVariantsBulkUpdate
async function updateDefaultVariantWithSDK(
  session: Session,
  productId: string,
  variantId: string,
  main: any
) {
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
  const variables = {
    productId,
    variants: [variant],
  };
  const response: any = await client.request(query, { variables });
  const data = response?.data?.productVariantsBulkUpdate;
  if (data?.userErrors?.length) {
    console.error("Erreur maj variante (bulkUpdate):", data.userErrors);
  } else {
    console.log("Variante maj (bulkUpdate):", data.productVariants?.[0]);
  }
  return data?.productVariants?.[0]?.id;
}

// Création bulk des variantes via Shopify API (pour produits avec options)
async function bulkCreateVariantsWithSDK(
  session: Session,
  productId: string,
  variants: any[]
) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id price sku barcode compareAtPrice }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    productId,
    variants,
  };
  const response: any = await client.request(query, { variables });
  const data = response;
  return data?.data?.productVariantsBulkCreate;
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
            edges { node { id sku title selectedOptions { name value } price compareAtPrice barcode }
            }
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

export async function setupShop({ session }: { session: Session }) {
  try {
    // 1. Créer la page Livraison
    await createLivraisonPageWithSDK(session);

    // 2. Mettre à jour le menu principal
    const mainMenuResult = await getMainMenuIdAndTitle(session);
    if (mainMenuResult) {
      await updateMainMenu(session, mainMenuResult.id, mainMenuResult.title);
    } else {
      console.error("Main menu introuvable !");
    }

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
            ...new Set(
              group
                .map((row) => (row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : ""))
                .filter((v) => !!v && v !== "Default Title")
            ),
          ].map((v) => ({ name: v }));
          if (optionValues.length) {
            productOptions.push({ name: optionName, values: optionValues });
          }
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
          console.error(
            "Aucun productId généré.",
            JSON.stringify(productCreateData, null, 2)
          );
          continue;
        }
        console.log("Product créé avec id:", productId);

        // Upload images produit (hors variantes)
        const allImagesToAttach = [
          ...new Set([
            ...group.map((row) => row["Image Src"]).filter(Boolean),
          ]),
        ];
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          await createProductMedia(session, productId, normalizedUrl, "");
        }

        // Produit avec variantes (options)
        if (productOptionsOrUndefined && productOptionsOrUndefined.length > 0) {
          const seen = new Set<string>();
          const variants = group
            .map((row, idx) => {
              const optionValues: { name: string; optionName: string }[] = [];
              productOptions.forEach((opt, optIdx) => {
                const value =
                  row[`Option${optIdx + 1} Value`] &&
                  row[`Option${optIdx + 1} Value`].trim();
                if (value && value !== "Default Title") {
                  optionValues.push({ name: value, optionName: opt.name });
                }
              });
              const key = optionValues.map((ov) => ov.name).join("|");
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
            .filter((v) => v && v.optionValues && v.optionValues.length);

          // Création des variantes en bulk
          if (variants.length > 1) {
            await bulkCreateVariantsWithSDK(
              session,
              productId,
              variants.slice(1)
            );
          }

          // Update de la première variante Shopify
          const edges = productData?.variants?.edges;
          if (edges && edges.length) {
            const firstVariantId = edges[0].node.id;
            await updateDefaultVariantWithSDK(session, productId, firstVariantId, group[0]);
          }
        }

        // Boucle : upload media + rattachement pour chaque variante existante (productVariantAppendMedia mediaIds tableau)
        const edges = productData?.variants?.edges;
        if (edges && edges.length) {
          for (const edge of edges) {
            const variantId = edge.node.id;
            // Recherche la row du CSV correspondant à cette variante via les options
            const matchingRow = group.find(row =>
              edge.node.selectedOptions.every((opt: any) =>
                row[`Option${opt.index + 1} Value`] === opt.value
              )
            ) || group[0];
            const variantImageUrl = matchingRow["Variant Image"];
            if (variantImageUrl && variantImageUrl.trim() &&
                variantImageUrl !== "nan" && variantImageUrl !== "null" && variantImageUrl !== "undefined") {
              const normalizedUrl = normalizeImageUrl(variantImageUrl);
              const mediaId = await createProductMedia(session, productId, normalizedUrl, "");
              if (mediaId) {
                const ready = await waitForMediaReady(session, productId, mediaId, 20000);
                if (ready) {
                  await appendMediaToVariant(session, productId, variantId, mediaId);
                } else {
                  console.error("Media non READY après upload : pas de rattachement", mediaId);
                }
              }
            }
          }
        }
        await new Promise((res) => setTimeout(res, 300));
      } catch (err) {
        console.error("Erreur création produit GraphQL", handleUnique, err);
      }
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
