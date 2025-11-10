// api/callback.js
export default async function handler(req, res) {
  try {
    const { shop, code } = req.query;

    if (!shop || !code) {
      return res.status(400).json({ error: "Missing shop or code parameter" });
    }

    // Échange du code contre un access_token Shopify
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      })
    });

    if (!tokenResponse.ok) {
      return res.status(401).json({ error: "Token exchange failed" });
    }

    const { access_token } = await tokenResponse.json();

    // Pose les cookies HTTP-only pour sécuriser
    res.setHeader("Set-Cookie", [
      `shop=${encodeURIComponent(shop)}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      `accessToken=${encodeURIComponent(access_token)}; HttpOnly; Secure; SameSite=Lax; Path=/`
    ]);

    // Redirection automatique vers /api/setup
    res.writeHead(302, { Location: "/api/setup" });
    res.end();
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).json({ error: "OAuth callback error", details: err.message });
  }
}
