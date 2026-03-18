/**
 * Shopify access-token resolver.
 *
 * Priority:
 * 1. In-memory cache (fast path for warm Vercel containers)
 * 2. Encrypted cookie set during OAuth callback (survives cold starts)
 * 3. Token Exchange API (last resort – requires Shopify Partner dashboard config)
 */

import { NextRequest } from "next/server";
import { getToken, storeToken } from "./tokenStore";
import { readTokenCookie } from "./cookieToken";

export async function getAccessToken(
  shop: string,
  sessionToken: string,
  req?: NextRequest
): Promise<{ accessToken: string; scope: string }> {
  // 1. In-memory cache
  const cached = getToken(shop);
  if (cached) {
    return cached;
  }

  // 2. Encrypted cookie (set during OAuth callback)
  if (req) {
    const fromCookie = readTokenCookie(req);
    if (fromCookie && fromCookie.shop.replace(/\.myshopify\.com$/, "") === shop.replace(/\.myshopify\.com$/, "")) {
      console.log(`[TokenResolver] Using cookie token for ${shop}`);
      // Cache in memory for subsequent calls in the same container
      storeToken(fromCookie.shop, fromCookie.accessToken, fromCookie.scope);
      return { accessToken: fromCookie.accessToken, scope: fromCookie.scope };
    }
  }

  // 3. Token Exchange API (last resort)
  console.log(`[TokenResolver] Cache + cookie miss for ${shop} – trying Token Exchange`);

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

  storeToken(shop, accessToken, scope);
  console.log(`[TokenExchange] Success for ${shop}, scope: ${scope}`);
  return { accessToken, scope };
}
