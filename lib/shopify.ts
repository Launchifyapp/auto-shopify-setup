import '@shopify/shopify-api/adapters/node'; // ← PATCH CRUCIAL pour le runtime Node.js !
import { shopifyApi, Session, ApiVersion } from "@shopify/shopify-api";

// Sécurisation du hostName depuis SHOPIFY_APP_URL
function getHostName() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("Variable d'environnement SHOPIFY_APP_URL manquante !");
  try {
    const parsedUrl = new URL(appUrl);
    return parsedUrl.host;
  } catch (e) {
    return appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.October23, // ← adapte selon ce que ton SDK supporte
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
  hostName: getHostName(),
  isEmbeddedApp: false,
  // sessionStorage: ... (optionnel)
});

// Fonction GraphQL compatible SDK et Node
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
