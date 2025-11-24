import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";

// Recherche l'id de la collection principale ("all" ou titre "Produits" ou "All" ou "Tous les produits")
async function getAllProductsCollectionId(session: Session): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query Collections {
      collections(first: 10) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.collections?.edges ?? [];
  let coll = edges.find((e: any) => e?.node?.handle === "all");
  if (!coll) coll = edges.find((e: any) => {
    const title = e?.node?.title?.toLowerCase();
    return title === "produits" || title === "all" || title === "tous les produits";
  });
  if (!coll && edges.length > 0) coll = edges[0];
  if (coll) return coll.node.id;
  return null;
}

// Recherche l'id d'une page par handle (filtrage côté client)
async function getPageIdByHandle(session: Session, handle: string): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query Pages {
      pages(first: 10) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.pages?.edges ?? [];
  const found = edges.find((e: any) => e.node.handle === handle);
  return found ? found.node.id : null;
}

// Pour debug : liste toutes les pages existantes (handle, titre, id)
async function debugListAllPages(session: Session) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query {
      pages(first: 30) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.pages?.edges ?? [];
  console.log("Pages existantes:");
  edges.forEach((e: any) => {
    console.log(e.node.title, e.node.handle, e.node.id);
  });
}

// Récupération menu principal : id + titre
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
  const mainMenu = edges.find((e: any) => e.node.handle === "main-menu");
  if (mainMenu) return {id: mainMenu.node.id, title: mainMenu.node.title};
  if (edges.length) return {id: edges[0].node.id, title: edges[0].node.title};
  return null;
}

// Patch menu principal (title requis, destination=resourceId/url)
// Utilise fallback HTTP si la page Contact n'est pas retrouvée
async function updateMainMenu(
  session: Session,
  menuId: string,
  menuTitle: string,
  livraisonPageId: string | null,
  collectionId: string | null,
  contactPageId: string | null
) {
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
            id
            title
            url
            resourceId
            type
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
      type: "FRONTPAGE",
      url: "/"
    },
    collectionId && {
      title: "Nos Produits",
      type: "COLLECTION",
      resourceId: collectionId
    },
    livraisonPageId && {
      title: "Livraison",
      type: "PAGE",
      resourceId: livraisonPageId
    },
    contactPageId
      ? {
          title: "Contact",
          type: "PAGE",
          resourceId: contactPageId
        }
      : {
          title: "Contact",
          type: "HTTP",
          url: "/pages/contact"
        }
  ].filter(Boolean);
  const variables = {
    id: menuId,
    title: menuTitle,
    items
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.menuUpdate?.userErrors?.length) {
    console.error("Erreur menuUpdate:", response.data.menuUpdate.userErrors);
    // Diagnostic auto : liste toutes les pages si erreur sur Contact
    if (
      response.data.menuUpdate.userErrors.some((err: any) => (err.message || "").toLowerCase().includes("page not found"))
    ) {
      await debugListAllPages(session);
    }
  } else {
    console.log("[Menu principal] Mis à jour :", response.data.menuUpdate.menu);
  }
}

// Création page Livraison
async function createLivraisonPageWithSDK(session: Session): Promise<string | null> {
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
  const variables = {
    input: {
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
    }
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.pageCreate?.userErrors?.length) {
    console.error("Erreur création page Livraison:", response.data.pageCreate.userErrors);
    return null;
  }
  const pageId = response?.data?.pageCreate?.page?.id ?? null;
  if (pageId) console.log("Page Livraison créée :", response.data.pageCreate.page);
  return pageId;
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

// Upload image dans les Files de Shopify (pas rattachées à un produit)
async function uploadImagesToShopifyFiles(session: Session, imageUrls: string[]): Promise<void> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on GenericFile {
            id
            url
            alt
            createdAt
          }
          ... on MediaImage {
            id
            image {
              url
              altText
            }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const files = imageUrls.map(url => ({
    alt: "",
    originalSource: url,
    contentType: "IMAGE"
  }));
  const variables = { files };
  const response: any = await client.request(query, { variables });
  if (response?.data?.fileCreate?.userErrors?.length) {
    console.error("Erreur upload Files:", response.data.fileCreate.userErrors);
  }
  ((response?.data?.fileCreate?.files || []) as any[]).forEach((file: any) => {
    if(file.image?.url){
      console.log("Image Shopify File:", file.id, file.image.url);
    } else if(file.url) {
      console.log("Fichier Shopify File:", file.id, file.url);
    }
  });
}

// Création d'une collection automatisée (smart) par tag
async function createAutomatedCollection(session: Session, title: string, handle: string, tag: string): Promise<{id: string, title: string} | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation collectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection {
          id
          title
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    input: {
      title: title,
      handle: handle,
      ruleSet: {
        appliedDisjunctively: false,
        rules: [
          {
            column: "TAG",
            relation: "EQUALS",
            condition: tag
          }
        ]
      }
    }
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.collectionCreate?.userErrors?.length) {
    console.error(`Erreur création collection "${title}":`, response.data.collectionCreate.userErrors);
    return null;
  }
  const collection = response?.data?.collectionCreate?.collection;
  if (collection) {
    console.log(`Collection créée: "${collection.title}" (ID: ${collection.id})`);
    return { id: collection.id, title: collection.title };
  }
  return null;
}

// Création des images sur un produit
async function createProductMedia(session: Session, productId: string, media: any[]): Promise<any[]> {
    const client = new shopify.clients.Graphql({ session });
    const query = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage { id status alt mediaContentType preview { image { url } } }
          }
          mediaUserErrors { field message }
        }
      }
    `;
    const variables = { productId, media };
    try {
        const response: any = await client.request(query, { variables });
        if (response?.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
            console.error("Erreurs lors de la création de media:", response.data.productCreateMedia.mediaUserErrors);
        }
        return response?.data?.productCreateMedia?.media ?? [];
    } catch (e) {
        console.error("Exception GQL createProductMedia", e);
        return [];
    }
}

// Associe des images à leurs variantes respectives
async function appendMediaToVariants(session: Session, productId: string, variantMedia: any[]) {
    if (variantMedia.length === 0) return;
    const client = new shopify.clients.Graphql({ session });
    const query = `
      mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
        productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
          productVariants {
            id
            media(first: 5) { edges { node { ... on MediaImage { id } } } }
          }
          userErrors { code field message }
        }
      }
    `;
    const variables = { productId, variantMedia };
    const response: any = await client.request(query, { variables });
    if (response?.data?.productVariantAppendMedia?.userErrors?.length > 0) {
      console.error("Erreur lors de l'association media-variante :", response.data.productVariantAppendMedia.userErrors);
    } else {
      console.log(`Association media-variante réussie pour le produit ${productId}`);
    }
}

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

// Récupère l'ID de la publication "Online Store"
async function getOnlineStorePublicationId(session: Session): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query GetPublications {
      publications(first: 10) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;
  try {
    const response: any = await client.request(query);
    const edges = response?.data?.publications?.edges ?? [];
    const onlineStorePub = edges.find((e: any) => e?.node?.name === "Online Store");
    if (onlineStorePub) {
      console.log(`Publication "Online Store" trouvée avec l'ID: ${onlineStorePub.node.id}`);
      return onlineStorePub.node.id;
    } else {
      console.error('Publication "Online Store" non trouvée.');
      return null;
    }
  } catch (error) {
    console.error("Erreur lors de la récupération des publications:", error);
    return null;
  }
}

// Publie une ressource (produit ou collection) sur un canal de vente donné
async function publishResource(session: Session, resourceId: string, publicationId: string): Promise<void> {
  const client = new shopify.clients.Graphql({ session });
  const mutation = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    id: resourceId,
    input: [{
      publicationId: publicationId,
    }],
  };
  try {
    const response: any = await client.request(mutation, { variables });
    if (response?.data?.publishablePublish?.userErrors?.length > 0) {
      console.error(`Erreur lors de la publication de la ressource ${resourceId}:`, response.data.publishablePublish.userErrors);
    } else {
      console.log(`Ressource ${resourceId} publiée avec succès sur ${publicationId}.`);
    }
  } catch (error) {
    console.error(`Exception lors de la publication de la ressource ${resourceId}:`, error);
  }
}


export async function setupShop({ session }: { session: Session }) {
  try {
    const idsToPublish: string[] = [];

    // --- UPLOAD DES 4 IMAGES GÉNÉRIQUES AU DÉBUT DANS SHOPIFY FILES ---
    const imagesUrls = [
      "https://auto-shopify-setup.vercel.app/image1.jpg",
      "https://auto-shopify-setup.vercel.app/image2.jpg",
      "https://auto-shopify-setup.vercel.app/image3.jpg",
      "https://auto-shopify-setup.vercel.app/image4.webp"
    ];
    await uploadImagesToShopifyFiles(session, imagesUrls);

    // --- Création des deux collections automatisées ("intelligentes") par TAG ---
    const beautyCollection = await createAutomatedCollection(session, "Beauté & soins", "beaute-soins", "Beauté & soins");
    if (beautyCollection?.id) idsToPublish.push(beautyCollection.id);

    const homeCollection = await createAutomatedCollection(session, "Maison & confort", "maison-confort", "Maison & confort");
    if (homeCollection?.id) idsToPublish.push(homeCollection.id);

    // 1. Créer la page Livraison
    const livraisonPageId = await createLivraisonPageWithSDK(session)
      || await getPageIdByHandle(session, "livraison");

    // 2. Récupérer la collection principale ("all")
    const mainCollectionId = await getAllProductsCollectionId(session);

    // 3. Récupérer id & titre du menu principal
    const mainMenuResult = await getMainMenuIdAndTitle(session);

    // 4. Chercher id de la page contact (handle="contact" dans Shopify)
    const contactPageId = await getPageIdByHandle(session, "contact");

    // 5. Mettre à jour le menu principal (avec resourceId ou url)
    if (mainMenuResult) {
      await updateMainMenu(
        session,
        mainMenuResult.id,
        mainMenuResult.title,
        livraisonPageId,
        mainCollectionId,
        contactPageId
      );
    } else {
      console.error("Main menu introuvable !");
    }

    // ... Reste du setup produit inchangé ci-dessous ...
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
        idsToPublish.push(productId); // Stocker l'ID du produit pour la publication

        // Produit avec variantes (options)
        if (productOptionsOrUndefined && productOptionsOrUndefined.length > 0) {
          const seen = new Set<string>();
          const variantsToCreate = group
            .map((row) => {
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
            .filter((v): v is any => v && v.optionValues && v.optionValues.length > 0);

          if (variantsToCreate.length > 1) {
            await bulkCreateVariantsWithSDK(session, productId, variantsToCreate.slice(1));
          }

          const firstVariantId = productData?.variants?.edges?.[0]?.node?.id;
          if (firstVariantId) {
            await updateDefaultVariantWithSDK(session, productId, firstVariantId, group[0]);
          }
        }

        // --- GESTION DES IMAGES ET DE LEUR ASSOCIATION (LOGIQUE CORRIGÉE) ---
        
        // 1. Collecter toutes les images uniques (générales et de variantes)
        const allImageUrls = [...new Set(
            group.flatMap(row => [row["Image Src"], row["Variant Image"]]).filter(Boolean)
        )];

        const mediaToCreate = allImageUrls.map(url => ({
            originalSource: normalizeImageUrl(url as string),
            mediaContentType: "IMAGE",
            alt: main.Title,
        }));
        
        // 2. Créer tous les media en une fois
        const createdMedia = await createProductMedia(session, productId, mediaToCreate);
        await new Promise(res => setTimeout(res, 3000)); // Attendre que les media soient prêts

        // 3. Préparer l'association variantes -> media
        const urlToMediaIdMap = new Map(createdMedia.map(m => [m.preview.image.url.split('?')[0], m.id]));
        const allVariants = productData?.variants?.edges?.map((e: any) => e.node) ?? [];
        
        const variantMediaPayload: any[] = [];
        
        for (const variant of allVariants) {
            const matchingRow = group.find(row => 
                variant.selectedOptions.every((opt: any) => {
                    const optionIndex = productOptions.findIndex(po => po.name === opt.name);
                    return optionIndex !== -1 && row[`Option${optionIndex + 1} Value`] === opt.value;
                })
            ) || group.find(row => row['Option1 Value'] === 'Default Title') || group[0];
            
            const variantImageUrl = matchingRow["Variant Image"];
            if (variantImageUrl) {
                const normalizedUrl = normalizeImageUrl(variantImageUrl).split('?')[0];
                const mediaId = urlToMediaIdMap.get(normalizedUrl);
                if (mediaId) {
                    variantMediaPayload.push({
                        variantId: variant.id,
                        mediaIds: [mediaId]
                    });
                }
            }
        }
        
        // 4. Associer toutes les variantes à leurs images en une seule mutation
        await appendMediaToVariants(session, productId, variantMediaPayload);

        await new Promise((res) => setTimeout(res, 300));
      } catch (err) {
        console.error("Erreur création produit GraphQL", handleUnique, err);
      }
    }
    
    // --- PUBLICATION DES PRODUITS ET COLLECTIONS SUR LE CANAL DE VENTE "ONLINE STORE" ---
    console.log("Fin de la création des ressources. Début de la publication...");

    const onlineStorePublicationId = await getOnlineStorePublicationId(session);

    if (onlineStorePublicationId && idsToPublish.length > 0) {
      for (const resourceId of idsToPublish) {
        await publishResource(session, resourceId, onlineStorePublicationId);
        await new Promise((res) => setTimeout(res, 300)); // Petit délai pour ne pas surcharger l'API
      }
      console.log("Toutes les ressources ont été traitées pour publication.");
    } else if (!onlineStorePublicationId) {
      console.error("Impossible de publier les ressources car l'ID de 'Online Store' n'a pas été trouvé.");
    } else {
      console.log("Aucune ressource à publier.");
    }

  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
