import { NextRequest } from "next/server";

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

  // Echange le code contre l'access_token Shopify
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

  // 👇 Redirige le client immédiatement vers la page de loader front pendant l'installation backend !
  // Pour une sécurité maximale, stocke le token en session ou en DB côté serveur et ne le passe pas en URL
  // Si tu veux juste le flow "démo", tu peux passer shop et token en query pour charger la page /loading
  const redirectUrl = `/loading?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(data.access_token)}`;
  return Response.redirect(redirectUrl, 302);

  // ✅ C'est la logique moderne : la page front /loading gère le spinner et le polling, et une API séparée lance runFullSetup en backend.
}
