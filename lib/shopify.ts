import { shopifyApi, ApiVersion, Session } from "@shopify/shopify-api";

// Configuration globale Shopify API v12+ (isCustomStoreApp ICI, pas dans Session)
export const shopify = shopifyApi({
  api: {
    apiVersion: ApiVersion.Latest, // Remplace LATEST_API_VERSION
    isCustomStoreApp: true, // Important : ici, jamais dans Session !
    adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
    privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
    // Ajoute d'autres options si nécessaire
  },
  // sessionStorage: ... (optionnel, selon tes besoins)
});

// Appel Shopify GraphQL universel (toujours via le client du shopifyApi !)
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

  // PATCH : Utilise le client GraphQL du shopifyApi global
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
