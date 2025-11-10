export default async function handler(req, res) {
  try {
    const { shop, code } = req.query;
    if (!shop || !code) {
      return res.status(400).json({ error: "Missing shop or code parameter" });
    }

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
      const txt = await tokenResponse.text().catch(() => "");
      return res.status(401).json({ error: "Token exchange failed", details: txt });
    }

    const { access_token } = await tokenResponse.json();

    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    const sameSite = process.env.SHOPIFY_EMBEDDED === "true" ? "None" : "Lax";

    res.setHeader("Set-Cookie", [
      `shop=${encodeURIComponent(shop)}; HttpOnly; ${isProd ? "Secure;" : ""} SameSite=${sameSite}; Path=/`,
      `accessToken=${encodeURIComponent(access_token)}; HttpOnly; ${isProd ? "Secure;" : ""} SameSite=${sameSite}; Path=/`
    ]);

    // 👉 redirection vers la version "lite"
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    res.writeHead(302, { Location: `${base}/api/setup-lite` });
    res.end();
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).json({ error: "OAuth callback error", details: err.message });
  }
}
