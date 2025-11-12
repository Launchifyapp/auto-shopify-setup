import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const shop = searchParams.get("shop");

  const client_id = process.env.SHOPIFY_API_KEY!;
  const client_secret = process.env.SHOPIFY_API_SECRET!;

  if (!code || !shop) {
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Erreur - Installation Shopify</title>
        </head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>🚫 Erreur lors de l'installation de l'application Shopify</h1>
          <p>Merci de réessayer ou contactez le support.<br/><b>Détail technique :</b> informations OAuth manquantes.</p>
        </body>
      </html>
    `;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
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
  } else {
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Erreur - Installation Shopify</title>
        </head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>🚫 Erreur lors de l'installation Shopify</h1>
          <p>Impossible d'obtenir l'accès à la boutique.<br/>
          Veuillez réessayer ou contactez le support.<br/>
          <b>Erreur technique :</b> ${data.error || 'OAuth Shopify'}</p>
        </body>
      </html>
    `;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }
}
