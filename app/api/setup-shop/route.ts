import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import shopify from "@shopify/shopify-api";

// Fonction utilitaire pour récupérer la session Shopify à partir du token et shop (adapté pour une app publique)
async function getSession(shop: string, accessToken: string) {
  // Si tu utilises des installations persistées/middleware Shopify, adapte cette logique.
  // Ici, on crée une session simple pour usage avec le client SDK.
  return new shopify.auth.Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "",
    isOnline: true,
    accessToken
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
    const session = await getSession(shop, token);
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
