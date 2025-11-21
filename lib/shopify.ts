import { shopifyApi, Session, ApiVersion } from "@shopify/shopify-api";

// Sécurisation + fallback pour hostName
function getHostName() {
  const host = process.env.SHOPIFY_APP_HOST;
  if (!host) throw new Error("Variable d'environnement SHOPIFY_APP_HOST manquante !");
  return host.replace(/^https?:\/\//, "");
}

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: "^12.1.2", // ← string si la constante n'existe pas
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
  hostName: getHostName(),
  isEmbeddedApp: false,
});

// Fonction GraphQL : inchangée
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
