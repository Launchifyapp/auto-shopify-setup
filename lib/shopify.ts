import { shopifyApi, Session, ApiVersion } from "@shopify/shopify-api";

// Utilise la bonne constante du type ApiVersion
// S'il n'existe pas ApiVersion.October25, regarde l'export de "@shopify/shopify-api" ou ta version installée
// Pour 2025-10 : ce sera probablement ApiVersion.October25 ou un nom équivalent

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.October25, // PATCH : version 2025-10, syntaxe correcte attendue par le type
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
  hostName: process.env.SHOPIFY_APP_HOST!.replace(/^https?:\/\//, ""),
  isEmbeddedApp: false,
  // sessionStorage: ... (optionnel)
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
