import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";
import { Language } from "@/lib/i18n";
import { DEFAULT_SESSION_SCOPE } from "@/lib/scopes";

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
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  const scope = searchParams.get("scope") || "";
  const langParam = searchParams.get("lang");
  const lang: Language = langParam === "en" ? "en" : "fr";

  if (!shop || !token) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing shop/token parameters!" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("[DEBUG setup-shop] shop:", shop, "token:", !!token, "scope:", scope, "lang:", lang);

  try {
    const session = getSession(shop, token, scope);
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
