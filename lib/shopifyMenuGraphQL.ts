// Fonction utilitaire pour requêtes GraphQL Shopify Admin
export async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {}
) {
  const res = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

// Récupérer le GID de la collection "all"
export async function getAllCollectionGID(shop: string, token: string): Promise<string | undefined> {
  const query = `
    query {
      collections(first: 10, query: "handle:all") {
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
  const result = await shopifyGraphQL(shop, token, query);
  const allCollection = result?.data?.collections?.edges?.find(
    (edge: any) => edge.node.handle === "all"
  );
  return allCollection ? allCollection.node.id : undefined;
}

// Récupérer le GID d'une page à partir du titre ou handle
export async function getPageGID(
  shop: string,
  token: string,
  pageTitleOrHandle: string
): Promise<string | undefined> {
  const query = `
    query {
      pages(first: 20) {
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
  const result = await shopifyGraphQL(shop, token, query);
  const page = result?.data?.pages?.edges?.find(
    (edge: any) =>
      edge.node.title.toLowerCase() === pageTitleOrHandle.toLowerCase() ||
      edge.node.handle === pageTitleOrHandle
  );
  return page ? page.node.id : undefined;
}

// Récupérer l'id du menu principal (main-menu)
export async function getMainMenuId(
  shop: string,
  token: string
): Promise<string | undefined> {
  const query = `
    query {
      navigationMenus(first: 10) {
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
  const result = await shopifyGraphQL(shop, token, query);

  // DEBUG : log la réponse brute pour analyse !
  console.log("Réponse brute navigationMenus:", JSON.stringify(result, null, 2));

  const menuList = result?.data?.navigationMenus?.edges;

  if (!menuList) {
    throw new Error(
      "La requête navigationMenus ne retourne rien : data ou navigationMenus absent. Vérifie la version de l'API ou le scope."
    );
  }

  const menu = menuList.find(
    (menu: any) => menu.node.handle === "main-menu"
  );
  return menu ? menu.node.id : undefined;
}

// Mettre à jour le menu principal avec les GID récupérés dynamiquement
export async function updateMainMenu(shop: string, token: string) {
  const menuId = await getMainMenuId(shop, token);
  if (!menuId)
    throw new Error("Menu principal introuvable (handle: main-menu)");

  // Récupération dynamique des GID
  const allCollectionGID = await getAllCollectionGID(shop, token);
  const livraisonGID = await getPageGID(shop, token, "Livraison");
  const faqGID = await getPageGID(shop, token, "FAQ");
  const contactGID = await getPageGID(shop, token, "Contact");

  const itemsInput: string[] = [
    `{ title: "Accueil", type: HOME, destination: { home: {} } }`,
    allCollectionGID
      ? `{ title: "Nos produits", type: COLLECTION, destination: { collection: { id: "${allCollectionGID}" } } }`
      : "",
    livraisonGID
      ? `{ title: "Livraison", type: PAGE, destination: { page: { id: "${livraisonGID}" } } }`
      : "",
    faqGID
      ? `{ title: "FAQ", type: PAGE, destination: { page: { id: "${faqGID}" } } }`
      : "",
    contactGID
      ? `{ title: "Contact", type: PAGE, destination: { page: { id: "${contactGID}" } } }`
      : ""
  ].filter(Boolean);

  const mutation = `
    mutation {
      navigationMenuUpdate(
        id: "${menuId}",
        input: {
          items: [${itemsInput.join(", ")}]
        }
      ) {
        navigationMenu {
          id
          items { title type }
        }
        userErrors { field message }
      }
    }
  `;

  const result = await shopifyGraphQL(shop, token, mutation);

  if (result.data?.navigationMenuUpdate?.userErrors?.length) {
    console.error(
      "Erreur Shopify:",
      result.data.navigationMenuUpdate.userErrors
    );
    throw new Error("Erreur update menu Shopify.");
  }

  console.log(
    "Menu principal mis à jour 🚀 !",
    result.data?.navigationMenuUpdate?.navigationMenu
  );
}
