import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";

// PATCH complet : on passe TOUS les champs requis par Shopify API v12+
function getSession(shop: string, accessToken: string): Session {
  if (!shop || typeof shop !== "string") {
    throw new Error("Paramètre shop manquant ou invalide !");
  }
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Paramètre token/accessToken manquant ou invalide !");
  }

  const scope = "read_products,write_products,write_files,read_files,write_online_store_pages,read_online_store_pages,write_content,read_content,write_themes,read_themes";

  return new Session({
    id: `${shop}_${Date.now()}`,
    shop: shop,
    state: "setup-shop", // string non vide
    isOnline: true,
    accessToken: accessToken,
    isCustomStoreApp: true,
    scope,
    expires: undefined,
    onlineAccessInfo: undefined
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");

  if (!shop || !token) {
    return new Response(
      JSON.stringify({ ok: false, error: "Paramètres shop/token manquants !" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Débogage ultra défensif :
  console.log("[DEBUG setup-shop] shop:", shop, "token:", !!token);

  try {
    const session = getSession(shop, token);
    await setupShop({ session });

    return new Response(
      JSON.stringify({ ok: true, message: "Setup boutique terminé !" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Erreur globale setupShop:", err?.message, err?.stack);
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
