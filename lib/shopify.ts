// API helper pour récupérer le thème principal
export async function getMainThemeId(shop: string, token: string): Promise<number | undefined> {
  const res = await fetch(`https://${shop}/admin/api/2024-01/themes.json`, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    }
  });
  const { themes } = await res.json();
  const mainTheme = themes.find((theme: any) => theme.role === "main");
  return mainTheme ? mainTheme.id : undefined;
}

// API helper pour créer une page Shopify
export async function createShopifyPage(shop: string, token: string, title: string, body_html: string) {
  return fetch(`https://${shop}/admin/api/2024-01/pages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      page: { title, body_html }
    })
  });
}

// API helper pour créer une smart collection
export async function createSmartCollection(shop: string, token: string, title: string, tag: string) {
  return fetch(`https://${shop}/admin/api/2024-01/smart_collections.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      smart_collection: {
        title,
        rules: [{ column: "tag", relation: "equals", condition: tag }]
      }
    })
  });
}

// Tu peux ajouter un export pour les fonctions GraphQL si besoin, 
// mais plus d'import setupShopifyMainMenu !
