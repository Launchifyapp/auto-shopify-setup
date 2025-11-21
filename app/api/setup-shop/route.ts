import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";

// PATCH pour Shopify API v12+ : tous les champs explicitement définis et NON undefined
function getSession(shop: string, accessToken: string): Session {
  if (!shop || !accessToken) {
    throw new Error("Paramètres shop/token manquants !");
  }

  // Scopes : adapte selon ton app. Ne laisse pas ce champ vide !
  const scope = "write_products,write_content";

  return new Session({
    id: `${shop}_${Date.now()}`,         // chaîne non vide
    shop: shop,                         // chaîne non vide
    state: "setup-shop",                // chaîne non vide
    isOnline: true,                     // ou false si offline
    accessToken: accessToken,           // chaîne non vide
    isCustomStoreApp: false,            // obligatoire pour v12+
    scope,                              // chaîne non vide
    expires: undefined,                 // optionnel
    onlineAccessInfo: undefined,        // optionnel
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

  // Log défense
  console.log("setup-shop API: shop:", shop, "token:", !!token);

  try {
    const session = getSession(shop, token);
    await setupShop({ session });

    return new Response(
      JSON.stringify({ ok: true, message: "Setup boutique terminé !" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Erreur globale setupShop:", err);
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
