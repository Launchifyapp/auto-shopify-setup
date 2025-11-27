import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";
import { Language } from "@/lib/i18n";
import { DEFAULT_SESSION_SCOPE } from "@/lib/scopes";
import { getToken } from "@/lib/utils/tokenStore";
import { authenticateRequest } from "@/lib/utils/verifySessionToken";

function getSession(shop: string, accessToken: string, scope: string): Session {
  if (!shop || typeof shop !== "string") {
    throw new Error("Missing or invalid shop parameter!");
  }
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing or invalid token/accessToken parameter!");
  }

  // Use the scope from OAuth if provided, otherwise use default
  const sessionScope = scope || DEFAULT_SESSION_SCOPE;

  return new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "setup-shop",
    isOnline: true,
    accessToken,
    scope: sessionScope,
    expires: undefined,
    onlineAccessInfo: undefined,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let shop = searchParams.get("shop");
  const langParam = searchParams.get("lang");
  const lang: Language = langParam === "en" ? "en" : "fr";

  // Try to authenticate using session token first (for embedded app)
  const sessionAuth = authenticateRequest(req);
  if (sessionAuth) {
    shop = sessionAuth.shop;
    console.log("[setup-shop] Authenticated via session token for shop:", shop);
  }

  if (!shop) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing shop parameter!" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get token from store
  const tokenData = getToken(shop);
  if (!tokenData) {
    return new Response(
      JSON.stringify({ ok: false, error: "No access token found. Please reinstall the app." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const { accessToken, scope } = tokenData;

  console.log("[DEBUG setup-shop] shop:", shop, "token:", !!accessToken, "scope:", scope, "lang:", lang);

  try {
    const session = getSession(shop, accessToken, scope);
    await setupShop({ session, lang });

    return new Response(
      JSON.stringify({ ok: true, message: "Store setup complete!" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Global setupShop error:", err?.message, err?.stack);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || String(err),
        stack: err?.stack || ""
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
