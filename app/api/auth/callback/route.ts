import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  // ... identique au dessus pour l'échange du code ...

  if (data.access_token) {
    // TODO: Stockage token si besoin

    // Renvoie une vraie page HTML
    const html = `
      <html>
        <head>
          <title>Installation réussie !</title>
        </head>
        <body>
          <h1>Bravo, l'installation Shopify est réussie !</h1>
          <p>Votre boutique est prête. Vous pouvez fermer cette page.</p>
        </body>
      </html>
    `;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });
  } else {
    return new Response("OAuth error", { status: 400 });
  }
}
