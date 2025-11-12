import { NextRequest } from "next/server";
import { runFullSetup } from "@/lib/setup";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const shop = searchParams.get("shop");

  const client_id = process.env.SHOPIFY_API_KEY!;
  const client_secret = process.env.SHOPIFY_API_SECRET!;

  // Vérifie présence code et shop dans la query
  if (!code || !shop) {
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Erreur - Installation Shopify</title>
        </head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>🚫 Erreur lors de l'installation de l'application Shopify</h1>
          <p>Merci de réessayer ou contactez le support.<br/><strong>Détail technique :</strong> informations OAuth manquantes.</p>
        </body>
      </html>
    `;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // Appel pour échanger le code contre un access_token Shopify
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

  // Si pas de token retourné => erreur
  if (!data.access_token) {
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Erreur - Installation Shopify</title>
        </head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>🚫 Erreur lors de l'installation Shopify</h1>
          <p>Impossible d'obtenir le jeton d'accès.<br/>Veuillez réessayer ou contacter le support.</p>
        </body>
      </html>`;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // On lance la configuration complète (pages/collections/produits…) AVANT d’afficher le succès
  try {
    await runFullSetup({ shop, token: data.access_token });
  } catch (err) {
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Erreur - Setup Shopify</title>
        </head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>🚫 Erreur lors du setup Shopify</h1>
          <p>Un problème est survenu lors de l'automatisation de ta boutique.<br/>
          ${typeof err === "string" ? err : (err instanceof Error ? err.message : "Erreur inconnue")}</p>
        </body>
      </html>
    `;
    return new Response(html, { status: 500, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // Page de succès finale, SANS caractères spéciaux foireux
  const html = `
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Succès - Installation Shopify</title>
      </head>
      <body style="font-family:Arial; margin:3rem;">
        <h1>✅ Installation réussie !</h1>
        <p>L'app Shopify est installée sur votre boutique.<br/>
        Vous pouvez fermer cette page ou revenir à votre dashboard.<br/>
        <a href="https://${shop}/admin/apps" style="color:#0077CC;">Retour vers Shopify</a></p>
      </body>
    </html>
  `;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=UTF-8" } });
}
