import { shopifyApi, Session } from "@shopify/shopify-api";

// Remplace ApiVersion.Latest par la chaîne de la version API actuelle, ex: "2023-10"
export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: "2025-10", // ← Mets ici ta version API Shopify !
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
  hostName: process.env.SHOPIFY_APP_HOST!.replace(/^https?:\/\//, ""),
  isEmbeddedApp: false, // ou true si ton app est embedded
  // sessionStorage: ... (si tu utilises une persistance custom)
});

// Fonction d'appel Shopify GraphQL via clients du SDK officiel
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
