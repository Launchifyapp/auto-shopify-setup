/**
 * Automatisation: Met à jour le menu principal ("main-menu") via Shopify GraphQL Admin API.
 * Prérequis : scope "write_navigation" dans l'app + token Admin API.
 * Usage : await updateMainMenu(shop, token)
 */

const SHOPIFY_ADMIN_GRAPHQL_URL = (shop: string) => `https://${shop}/admin/api/2023-07/graphql.json`;

async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {}
) {
  const res = await fetch(SHOPIFY_ADMIN_GRAPHQL_URL(shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

// 1. Get main-menu id
export async function getMainMenuId(shop: string, token: string): Promise<string | undefined> {
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
  const menu = result.data.navigationMenus.edges.find(
    (menu: any) => menu.node.handle === "main-menu"
  );
  return menu ? menu.node.id : undefined;
}

// 2. Update main-menu items
export async function updateMainMenu(shop: string, token: string) {
  const menuId = await getMainMenuId(shop, token);
  if (!menuId) {
    throw new Error("Menu principal introuvable (handle: main-menu)");
  }

  // Structure des nouveaux links
  const items = [
    {
      title: "Accueil",
      type: "HOME",
      destination: { home: {} }
    },
    {
      title: "Nos produits",
      type: "COLLECTION",
      // Remplacer collectionId par ton Collection GID si tu veux un lien vers une collection spécifique!
      destination: { collection: { id: "gid://shopify/Collection/your_collection_id" } }
    },
    {
      title: "Livraison",
      type: "PAGE",
      destination: { page: { id: "gid://shopify/Page/your_livraison_page_id" } }
    },
    {
      title: "FAQ",
      type: "PAGE",
      destination: { page: { id: "gid://shopify/Page/your_faq_page_id" } }
    },
    {
      title: "Contact",
      type: "PAGE",
      destination: { page: { id: "gid://shopify/Page/your_contact_page_id" } }
    }
  ];

  // Helper pour formater chaque item en GraphQL Input
  function graphqlMenuItem(item: any) {
    if (item.type === "HOME") {
      return `{ title: "${item.title}", type: HOME, destination: { home: {} } }`;
    }
    if (item.type === "COLLECTION") {
      return `{ title: "${item.title}", type: COLLECTION, destination: { collection: { id: "${item.destination.collection.id}" } } }`;
    }
    if (item.type === "PAGE") {
      return `{ title: "${item.title}", type: PAGE, destination: { page: { id: "${item.destination.page.id}" } } }`;
    }
    // Ajoute d'autres types si tu veux (ex: BLOG, PRODUCT, EXTERNAL)
    return "";
  }

  const itemsInputString = items.map(graphqlMenuItem).join(", ");

  // Mutation GraphQL
  const mutation = `
    mutation {
      navigationMenuUpdate(
        id: "${menuId}",
        input: {
          items: [${itemsInputString}]
        }
      ) {
        navigationMenu {
          id
          items {
            title
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

  const result = await shopifyGraphQL(shop, token, mutation);

  if (result.data?.navigationMenuUpdate?.userErrors?.length) {
    console.error("Erreur Shopify:", result.data.navigationMenuUpdate.userErrors);
    throw new Error("Erreur update menu Shopify.");
  }

  console.log("Menu principal mis à jour 🚀 !", result.data?.navigationMenuUpdate?.navigationMenu);
}
