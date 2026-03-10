/**
 * Shopify Token Exchange API utility
 *
 * Exchanges a session token (from App Bridge) for an offline access token.
 * This eliminates the need for persistent server-side token storage because
 * each API request can obtain a fresh access token using the session token
 * already present in the Authorization header.
 *
 * Reference:
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 */

import { getToken, storeToken } from "./tokenStore";

/**
 * Get a Shopify access token for the given shop.
 *
 * 1. Checks the in-memory cache first (fast path for warm containers).
 * 2. Falls back to the Token Exchange API using the session token from
 *    App Bridge (works across cold starts / different serverless instances).
 */
export async function getAccessToken(
  shop: string,
  sessionToken: string
): Promise<{ accessToken: string; scope: string }> {
  // Fast path – token already cached in this container
  const cached = getToken(shop);
  if (cached) {
    return cached;
  }

  console.log(`[TokenExchange] Cache miss for ${shop} – exchanging session token`);

  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set");
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id-token",
      requested_token_type:
        "urn:shopify:params:oauth:token-type:offline-access-token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[TokenExchange] Failed:", response.status, text);
    throw new Error(
      `Token exchange failed (${response.status}). Please reinstall the app.`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    console.error("[TokenExchange] No access_token in response:", data);
    throw new Error("Token exchange returned no access token.");
  }

  const accessToken: string = data.access_token;
  const scope: string = data.scope || "";

  // Cache for the lifetime of this container
  storeToken(shop, accessToken, scope);

  console.log(`[TokenExchange] Success for ${shop}, scope: ${scope}`);
  return { accessToken, scope };
}
