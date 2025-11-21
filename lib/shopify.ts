import { shopifyApi, ApiVersion, Session } from "@shopify/shopify-api";

// PATCH pour Shopify API v12+
// La config (tokens, isCustomStoreApp, apiVersion) est passée à la racine, PAS sous "api"
export const shopify = shopifyApi({
  apiVersion: ApiVersion.Latest,           // ← PAS dans un bloc "api"
  isCustomStoreApp: true,                  // ← à la racine
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
  // Ajoute ici ton sessionStorage si tu utilises une persistance custom
  // sessionStorage: ...
});

// Fonction d'appel Shopify GraphQL via l'API officielle (client global !)
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
