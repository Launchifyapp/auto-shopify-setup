import { shopifyApi, LATEST_API_VERSION, Session } from "@shopify/shopify-api";

// Configuration globale Shopify API : PATCH v12+ (isCustomStoreApp ici, pas dans Session)
export const shopify = shopifyApi({
  api: {
    apiVersion: LATEST_API_VERSION,
    isCustomStoreApp: true, // Obligatoire ici !
    adminApiAccessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
    privateAppStorefrontAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN!,
    // ... ajoute tes autres options ici si besoin
  },
  // Ajoute sessionStorage si tu utilises une persistance custom
  // sessionStorage: new CustomSessionStorage(),
});

// Nouvelle fonction d'appel Shopify GraphQL via SDK, version PATCHÉE
export async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {}
) {
  // Construct session Shopify v12+ (PAS de isCustomStoreApp ici)
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

  // Utilise le client GraphQL du shopifyApi global, PAS new GraphqlClient
  const client = new shopify.clients.Graphql({ session });

  const response: any = await client.query({
    data: {
      query,
      variables,
    },
  });

  // Retour .body du SDK
  if (response?.body) {
    return response.body;
  }
  // Fallback (peu probable)
  return response;
}

// Toutes vos opérations d'upload doivent passer par le client GraphQL (PAS REST)
