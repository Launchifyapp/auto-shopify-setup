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

async function waitForMediaReady(session: Session, productId: string, mediaId: string, timeoutMs = 15000) {}

// Ajout PATCH : publication après création de TOUS les produits !
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
  const response: any = await client.request(query);
  const onlineStore = (response?.data?.publications?.edges ?? []).find(
    (e: any) =>
      e?.node?.name?.toLowerCase().includes("online store") ||
      e?.node?.name?.toLowerCase().includes("boutique en ligne")
  );
  return onlineStore?.node?.id || null;
}

async function publishProductToOnlineStore(session: Session, productId: string, publicationId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation publishablePublish($id: ID!, $input: PublishablePublishInput!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product {
            id
            title
            publishedOnPublication(publicationId: $input.publicationId)
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    id: productId,
    input: { publicationId }
  };
  await client.request(query, { variables });
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

// ---------------------- LOGIC PRINCIPAL ----------------------

export async function setupShop({ session }: { session: Session }) {
  try {
    // Upload images génériques dans Files
    const imagesUrls = [
      "https://auto-shopify-setup.vercel.app/image1.jpg",
      "https://auto-shopify-setup.vercel.app/image2.jpg",
      "https://auto-shopify-setup.vercel.app/image3.jpg",
      "https://auto-shopify-setup.vercel.app/image4.webp"
    ];
    await uploadImagesToShopifyFiles(session, imagesUrls);

    // Création des deux collections automatisées par TAG
    await createAutomatedCollection(session, "Beauté & soins", "beaute-soins", "Beauté & soins");
    await createAutomatedCollection(session, "Maison & confort", "maison-confort", "Maison & confort");

    // Récupération des pages, menu, etc.
    const livraisonPageId = await createLivraisonPageWithSDK(session)
      || await getPageIdByHandle(session, "livraison");

    const mainCollectionId = await getAllProductsCollectionId(session);

    const mainMenuResult = await getMainMenuIdAndTitle(session);

    const contactPageId = await getPageIdByHandle(session, "contact");

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

    // --- Création des produits depuis CSV ---
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // Stocker les productIds créés !
    const createdProductIds: string[] = [];

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
        createdProductIds.push(productId);

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

        // ... variantes et images variantes (inchangé, raccourci ici)

      } catch (err) {
        console.error("Erreur création produit GraphQL", handleUnique, err);
      }
    }

    // ----------- PATCH FINAL : Publication des produits dans Online Store -----------
    const onlineStorePublicationId = await getOnlineStorePublicationId(session);
    if (onlineStorePublicationId) {
      for (const productId of createdProductIds) {
        await publishProductToOnlineStore(session, productId, onlineStorePublicationId);
      }
      console.log("Tous les produits ont été publiés sur le canal Online Store !");
    }

  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
