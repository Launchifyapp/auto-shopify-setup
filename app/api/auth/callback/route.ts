import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  const code = req.nextUrl.searchParams.get("code");
  const hmac = req.nextUrl.searchParams.get("hmac");
  const state = req.nextUrl.searchParams.get("state");

  if (!shop || !code) {
    return NextResponse.json({ error: "Missing shop or code" }, { status: 400 });
  }

  // Echange code contre access_token
  const apiKey = process.env.SHOPIFY_API_KEY!;
  const apiSecret = process.env.SHOPIFY_API_SECRET!;
  const url = `https://${shop}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    }),
  });

  const data = await res.json();

  // Tu peux ici stocker le token admin, shop, etc. dans une DB/session
  if (data.access_token) {
    // Page de confirmation simple
    return new NextResponse(`
      <html>
        <body style='color:white; background:#101010; font-family:sans-serif; text-align:center;'>
          <h1>Installation réussie 🎉</h1>
          <p>Votre boutique Shopify est connectée.<br/><br/>
          <b>Shop:</b> ${shop}<br/>
          <b>Token:</b> ${data.access_token.substr(0,8)}...<br/>
          </p>
          <p>Vous pouvez maintenant utiliser l'automatisation.</p>
        </body>
      </html>
    `, { headers: { "Content-Type": "text/html" } });
  } else {
    return NextResponse.json({ error: data.error ?? "Impossible de récupérer le token." }, { status: 400 });
  }
}
