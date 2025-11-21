import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";

function getSession(shop: string, accessToken: string): Session {
  // Patch Session Shopify v12+ — isCustomStoreApp obligatoire !
  return new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "",
    isOnline: true,
    accessToken,
    isCustomStoreApp: false, // <= CECI corrige l’erreur !
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
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
