import { NextRequest } from "next/server";
import { runFullSetup } from "@/lib/setup";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const shop = searchParams.get("shop");

  const client_id = process.env.SHOPIFY_API_KEY!;
  const client_secret = process.env.SHOPIFY_API_SECRET!;

  if (!code || !shop) {
    // ... page erreur (voir plus haut) ...
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id,
      client_secret,
      code,
    }),
  });

  const data = await response.json();

  if (data.access_token) {
    try {
      // On lance la configuration complète (création pages, collections, etc)
      await runFullSetup({ shop, token: data.access_token });
    } catch (err) {
      // Option: affiche une page d'erreur spécifique setup (pages, collections, ...)
      const html = `<html><head><meta charset="UTF-8"><title>Erreur - Setup Shopify</title></head>
      <body style="font-family:Arial;"><h1>Erreur lors du setup Shopify</h1><p>${String(err)}</p></body></html>`;
      return new Response(html, { status: 500, headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    // Affiche ensuite une page de succès !
    const html = `<html><head><meta charset="UTF-8"><title>Succès</title></head>
    <body style="font-family:Arial; margin:3rem;"><h1>✅ Installation réussie !</h1>
      <p>Pages et collections créées.<br />Vous pouvez fermer cette page ou revenir à Shopify.<br />
      <a href="https://${shop}/admin/apps" style="color:#0077CC;">Retour vers Shopify</a></p></body></html>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  } else {
    // ... page erreur (voir plus haut) ...
  }
}
