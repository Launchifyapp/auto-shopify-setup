import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";

// PATCH ULTRA-DÉFENSIF pour Shopify API v12+ — évite "Cannot read property of undefined (reading 'isCustomStoreApp')"
function getSession(shop: string | null, accessToken: string | null): Session {
  if (!shop || typeof shop !== "string") {
    throw new Error("Paramètre shop manquant ou invalide !");
  }
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Paramètre token/accessToken manquant ou invalide !");
  }

  // Scopes : adapte selon ce que tu as obtenu à l’auth OAuth
  const scope = "read_products, write_products, write_files, read_files, write_online_store_pages, read_online_store_pages, write_content, read_content, write_themes, read_themes";

  // Création explicite du Session : tous les champs requis de façon sûre
  const sessionObj = {
    id: `${shop}_${Date.now()}`,
    shop: shop,
    state: "setup-shop",                // chaîne non vide
    isOnline: true,                     // booléen
    accessToken: accessToken,           // chaîne non vide
    isCustomStoreApp: false,            // booléen, obligatoire v12+
    scope,                              // chaîne non vide
    expires: undefined,                 // date ou undefined
    onlineAccessInfo: undefined         // objet ou undefined
  };

  // Log défensif pour debug serverless/Edge
  console.log("[DEBUG Session]", sessionObj);

  return new Session(sessionObj);
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

    // Toujours passer le session au setupShop !
    await setupShop({ session });

    return new Response(
      JSON.stringify({ ok: true, message: "Setup boutique terminé !" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    // Log ultra complet pour diagnostic serveur/serverless
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
