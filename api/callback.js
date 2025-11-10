// api/callback.js
export default async function handler(req, res) {
  try {
    const { shop, code } = req.query;
    if (!shop || !code) return res.status(400).json({ error: "Missing shop or code parameter" });

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
      const txt = await tokenResponse.text();
      return res.status(401).json({ error: "Token exchange failed", details: txt });
    }

    const { access_token } = await tokenResponse.json();

    const isProd = (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production");
    const embedded = process.env.SHOPIFY_EMBEDDED === "true";
    const sameSite = embedded ? "None" : "Lax";
    const secureFlag = isProd ? " Secure;" : ""; // en local Vercel Dev, pas de Secure

    res.setHeader("Set-Cookie", [
      `shop=${encodeURIComponent(shop)}; HttpOnly;${secureFlag} SameSite=${sameSite}; Path=/`,
      `accessToken=${encodeURIComponent(access_token)}; HttpOnly;${secureFlag} SameSite=${sameSite}; Path=/`
    ]);

    // Redirige vers l’étape d’auto-setup (fonction serverless)
    const base = process.env.NEXT_PUBLIC_APP_URL || ""; // ex: https://<app>.vercel.app
    const location = `${base}/api/setup`;
    res.writeHead(302, { Location: location });
    res.end();
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).json({ error: "OAuth callback error", details: err?.message || String(err) });
  }
}
