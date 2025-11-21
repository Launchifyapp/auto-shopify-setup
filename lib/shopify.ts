import { Session, GraphqlClient } from "@shopify/shopify-api";

// Nouvelle fonction d'appel Shopify GraphQL via SDK (migration complète)
export async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {}
) {
  // Construct session Shopify compatible v12+
  const session = new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "shopify-graphql",
    isOnline: true,
    accessToken: token,
    isCustomStoreApp: false,
    scope: "write_products,read_products,write_files,read_files,write_online_store_pages,read_online_store_pages,write_content,read_content,write_themes,read_themes", // adapte selon ton OAuth
    expires: undefined,
    onlineAccessInfo: undefined,
  });

  // Utilise le GraphqlClient du SDK
  const client = new GraphqlClient({ session });

  const response: any = await client.query({
    data: {
      query,
      variables,
    },
  });

  // Le retour SDK a un .body en général
  if (response?.body) {
    return response.body;
  }
  // Fallback (peu probable)
  return response;
}

// supprime shopifyREST upload pour images
