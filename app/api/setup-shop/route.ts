import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";
import { Language } from "@/lib/i18n";

function getSession(shop: string, accessToken: string): Session {
  if (!shop || typeof shop !== "string") {
    throw new Error("Missing or invalid shop parameter!");
  }
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing or invalid token/accessToken parameter!");
  }

  const scope = "read_products,write_products,write_files,read_files,write_online_store_pages,read_online_store_pages,write_content,read_content,write_themes,read_themes";

  return new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "setup-shop",
    isOnline: true,
    accessToken,
    scope,
    expires: undefined,
    onlineAccessInfo: undefined,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  const langParam = searchParams.get("lang");
  const lang: Language = langParam === "en" ? "en" : "fr";

  if (!shop || !token) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing shop/token parameters!" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("[DEBUG setup-shop] shop:", shop, "token:", !!token, "lang:", lang);

  try {
    const session = getSession(shop, token);
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
