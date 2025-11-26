import { NextRequest } from "next/server";

// ATTENTION : Utilise une URL ABSOLUE pour Response.redirect !

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const shop = searchParams.get("shop");

  const client_id = process.env.SHOPIFY_API_KEY!;
  const client_secret = process.env.SHOPIFY_API_SECRET!;

  if (!code || !shop) {
    const html = `
      <html>
        <head><meta charset="UTF-8"><title>Erreur - Installation Shopify</title></head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>🚫 Erreur lors de l'installation de l'application Shopify</h1>
          <p>Merci de réessayer ou contactez le support.<br/><strong>Détail technique :</strong> informations OAuth manquantes.</p>
        </body>
      </html>
    `;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // Récupère le jeton d'accès Shopify via OAuth
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id, client_secret, code }),
  });

  const data = await response.json();

  if (!data.access_token) {
    const html = `
      <html>
        <head><meta charset="UTF-8"><title>Erreur - Installation Shopify</title></head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>🚫 Erreur lors de l'installation Shopify</h1>
          <p>Impossible d'obtenir le jeton d'accès.<br/>Veuillez réessayer ou contacter le support.</p>
        </body>
      </html>`;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // REDIRECTION ABSOLUE obligatoire !
  const appBase = process.env.NEXT_PUBLIC_BASE_URL || "https://launchify.tech";
  const redirectUrl = `${appBase}/loading?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(data.access_token)}`;

  return Response.redirect(redirectUrl, 302);
}
