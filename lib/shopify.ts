import { shopifyApi, Session, ApiVersion } from "@shopify/shopify-api";

// Sécurisation du hostName depuis SHOPIFY_APP_URL
function getHostName() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("Variable d'environnement SHOPIFY_APP_URL manquante !");
  // Si tu as https://monapp.vercel.app ou http://..., on retire le protocole ET le slash final
  // et on prend seulement le hostname
  let url;
  try {
    url = new URL(appUrl);
    return url.host;
  } catch (e) {
    // Si pas une vraie URL, fallback sur le replace simple:
    return appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.October23, // adapte selon SDK, ou ApiVersion.October25
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
  hostName: getHostName(),
  isEmbeddedApp: false,
  // sessionStorage: ... (optionnel)
});

// Fonction GraphQL inchangée
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
