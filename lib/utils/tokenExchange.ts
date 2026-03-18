/**
 * Shopify access-token resolver.
 *
 * Priority:
 * 1. In-memory cache (fast path for warm Vercel containers)
 * 2. Encrypted cookie set during OAuth callback (survives cold starts)
 * 3. Token Exchange via Shopify SDK (works across cold starts)
 */

import { NextRequest } from "next/server";
import { getToken, storeToken } from "./tokenStore";
import { readTokenCookie } from "./cookieToken";
import { shopify } from "@/lib/shopify";
import { RequestedTokenType } from "@shopify/shopify-api";

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
      storeToken(fromCookie.shop, fromCookie.accessToken, fromCookie.scope);
      return { accessToken: fromCookie.accessToken, scope: fromCookie.scope };
    }
  }

  // 3. Token Exchange via Shopify SDK (handles correct URNs automatically)
  console.log(`[TokenResolver] Cache + cookie miss for ${shop} – using SDK Token Exchange`);

  try {
    const { session } = await shopify.auth.tokenExchange({
      shop,
      sessionToken,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
    });

    const accessToken = session.accessToken!;
    const scope = session.scope || "";

    storeToken(shop, accessToken, scope);
    console.log(`[TokenExchange] Success for ${shop}, scope: ${scope}`);
    return { accessToken, scope };
  } catch (err: any) {
    console.error("[TokenExchange] SDK error:", err?.message || err);
    throw new Error(
      `Token exchange failed: ${err?.message || String(err)}`
    );
  }
}
