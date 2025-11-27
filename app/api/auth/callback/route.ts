import { NextRequest } from "next/server";

// ATTENTION : Utilise une URL ABSOLUE pour Response.redirect !

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const shop = searchParams.get("shop");
  const stateParam = searchParams.get("state");

  // Extract display language from state parameter
  let displayLang = "fr";
  if (stateParam) {
    try {
      const stateData = JSON.parse(decodeURIComponent(stateParam));
      if (stateData.displayLang === "en" || stateData.displayLang === "fr") {
        displayLang = stateData.displayLang;
      }
    } catch (e) {
      // Default to French if parsing fails
    }
  }

  const client_id = process.env.SHOPIFY_API_KEY!;
  const client_secret = process.env.SHOPIFY_API_SECRET!;

  if (!code || !shop) {
    const html = `
      <html>
        <head><meta charset="UTF-8"><title>Error - Shopify Installation</title></head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>Error during Shopify app installation</h1>
          <p>Please try again or contact support.<br/><strong>Technical detail:</strong> missing OAuth information.</p>
        </body>
      </html>
    `;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // Get Shopify access token via OAuth
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id, client_secret, code }),
  });

  const data = await response.json();

  if (!data.access_token) {
    const html = `
      <html>
        <head><meta charset="UTF-8"><title>Error - Shopify Installation</title></head>
        <body style="font-family:Arial;margin:3rem;">
          <h1>Error during Shopify installation</h1>
          <p>Unable to obtain access token.<br/>Please try again or contact support.</p>
        </body>
      </html>`;
    return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // Capture the scope returned by Shopify OAuth (the actual permissions granted)
  const grantedScope = data.scope || "";
  console.log("[OAuth callback] Granted scope:", grantedScope);

  // Redirect to store language selection page (before loader)
  const appBase = process.env.NEXT_PUBLIC_BASE_URL || "https://auto-shopify-setup.vercel.app";
  const redirectUrl = `${appBase}/select-language?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(data.access_token)}&scope=${encodeURIComponent(grantedScope)}&displayLang=${displayLang}`;

  return Response.redirect(redirectUrl, 302);
}
