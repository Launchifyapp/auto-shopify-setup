import '@shopify/shopify-api/adapters/node';
import { shopifyApi, Session, ApiVersion } from "@shopify/shopify-api";
import { DEFAULT_SESSION_SCOPE } from "@/lib/scopes";

function getHostName() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) return "localhost";
  try {
    const parsedUrl = new URL(appUrl);
    return parsedUrl.host;
  } catch (e) {
    return appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
  console.error("[shopify] SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set!");
}

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.January25,
  isCustomStoreApp: false,
  hostName: getHostName(),
  isEmbeddedApp: true,
});

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
  const response: any = await client.request(query, variables);
  return response;
}
