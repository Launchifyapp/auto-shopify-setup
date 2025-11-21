import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";

function getSession(shop: string, accessToken: string): Session {
  return new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "setup-shop",      // met un string non vide (important)
    isOnline: true,           // ou false selon ton usage (connexion offline/online)
    accessToken,              // ton token OAuth/boutique
    isCustomStoreApp: false,  // ou true si tu es une custom app
    scope: "write_products,write_content,new_permissions", // permissions (met celles dont tu as besoin)
    expires: undefined,       // tu peux mettre une date ou undefined selon le contexte
    onlineAccessInfo: undefined, // optionnel
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
