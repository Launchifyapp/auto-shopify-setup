import { shopifyApi, ApiVersion, Session } from "@shopify/shopify-api";

// Configuration complète requise pour shopifyApi v12+
// Ajoute bien les champs obligatoires : apiKey, apiSecretKey, hostName, isEmbeddedApp...
export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,                  // clé publique de ton app
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,         // clé secrète de ton app
  apiVersion: ApiVersion.Latest,                         // version API
  isCustomStoreApp: true,                                // ← important ici
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!, // token Admin API
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!, // token Storefront API pour apps custom/private
  hostName: process.env.SHOPIFY_APP_HOST!.replace(/^https?:\/\//, ""),   // nom d'hôte sans https://
  isEmbeddedApp: false,                                  // ou true selon ton app
  // ... Ajoute sessionStorage ici si tu utilises une persistance custom
  // sessionStorage: ...
});

// Fonction d'appel Shopify GraphQL via l'API officielle (client global)
export async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {}
) {
  const session = new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "shopify-graphql",
    isOnline: true,
    accessToken: token,
    scope: "write_products,read_products,write_files,read_files,write_online_store_pages,read_online_store_pages,write_content,read_content,write_themes,read_themes",
    expires: undefined,
    onlineAccessInfo: undefined,
  });

  // Utilise le client GraphQL du shopifyApi global
  const client = new shopify.clients.Graphql({ session });

  const response: any = await client.query({
    data: {
      query,
      variables,
    },
  });

  if (response?.body) {
    return response.body;
  }
  return response;
}
