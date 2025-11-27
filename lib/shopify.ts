import '@shopify/shopify-api/adapters/node'; // ← Adapter Node obligatoire
import { shopifyApi, Session, ApiVersion } from "@shopify/shopify-api";
import { DEFAULT_SESSION_SCOPE } from "@/lib/scopes";

// Host extraction sécurisé
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
  apiVersion: ApiVersion.October23, // Adapte selon le support du SDK
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
  hostName: getHostName(),
  isEmbeddedApp: false,
  // sessionStorage: ... (optionnel)
});

// Fonction GraphQL - PATCH v12+ : utilise .request() au lieu de .query()
export async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {},
  scope: string = DEFAULT_SESSION_SCOPE
) {
  const session = new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "shopify-graphql",
    isOnline: true,
    accessToken: token,
    scope,
    expires: undefined,
    onlineAccessInfo: undefined,
  });

  const client = new shopify.clients.Graphql({ session });

  // Utilise .request(), pas .query() (corrigé v12+)
  const response: any = await client.request(query, variables);

  return response;
}
