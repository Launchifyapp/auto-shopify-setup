import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";

// Fonction pour créer la session Shopify > v12, compatible tous contextes
function getSession(shop: string, accessToken: string): Session {
  return new Session({
    id: `${shop}_${Date.now()}`,
    shop: shop ?? "",
    state: "setup-shop",      // doit être une string non vide
    isOnline: true,
    accessToken: accessToken ?? "",
    isCustomStoreApp: false,  // Obligatoire pour apps publiques Shopify
    scope: "write_products,write_content", // adapte selon tes scopes
    expires: undefined,       // optionnel (si tu utilises offline)
    onlineAccessInfo: undefined // optionnel
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

  try {
    const session = getSession(shop, token);
    await setupShop({ session });

    return new Response(
      JSON.stringify({ ok: true, message: "Setup boutique terminé !" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
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
