import { NextRequest, NextResponse } from "next/server";
import { runFullSetup } from "../../../../lib/setup";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  const code = req.nextUrl.searchParams.get("code");

  if (!shop || !code) {
    return NextResponse.json({ error: "Missing shop or code" }, { status: 400 });
  }

  const apiKey = process.env.SHOPIFY_API_KEY!;
  const apiSecret = process.env.SHOPIFY_API_SECRET!;
  const url = `https://${shop}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });
  const data = await res.json();
  const accessToken = data.access_token;

  if (accessToken) {
    try {
      await runFullSetup({ shop, token: accessToken });
      const html = `
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Auto Shopify Setup</title>
          </head>
          <body style='color:white; background:#101010; font-family:sans-serif; text-align:center;'>
            <h1>Automatisation terminée 🎉</h1>
            <p>Boutique: ${shop}<br>
            Token: ${accessToken.substr(0,8)}...<br><br>
            Tous les produits, pages, collections, le menu et le thème ont été créés.<br/>
            Le setup est maintenant en ligne sur votre boutique.</p>
          </body>
        </html>
      `;
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (err) {
      let msg = "Erreur inconnue";
      if (typeof err === "object" && err && "message" in err) {
        msg = (err as { message?: string }).message ?? "Erreur inconnue";
      } else if (typeof err === "string") {
        msg = err;
      }
      const html = `
        <html>
          <head><meta charset="UTF-8"></head>
          <body style='color:#ffdddd; background:#101010; font-family:sans-serif; text-align:center;'>
            <h1>Erreur pendant le setup !</h1>
            <pre>${msg}</pre>
          </body>
        </html>
      `;
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  } else {
    return NextResponse.json({ error: "Impossible de récupérer le token." }, { status: 400 });
  }
}
