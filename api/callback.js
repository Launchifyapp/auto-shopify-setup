// api/callback.js
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { shop, code } = req.query;
    if (!shop || !code) {
      return res.status(400).json({ error: "Missing shop or code parameter" });
    }

    // Échange code -> access_token
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
      const text = await tokenResponse.text().catch(() => "");
      return res.status(401).json({ error: "Token exchange failed", details: text });
    }

    const { access_token } = await tokenResponse.json();

    // Cookies (HttpOnly). Pour les apps embedded, SameSite=None + Secure obligatoire.
    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    const embedded = process.env.SHOPIFY_EMBEDDED === "true";
    const sameSite = embedded ? "None" : "Lax";
    const secure = isProd ? " Secure;" : "";

    // 7 jours (adapte si besoin)
    const maxAge = "Max-Age=604800";

    res.setHeader("Set-Cookie", [
      `shop=${encodeURIComponent(shop)}; HttpOnly;${secure} SameSite=${sameSite}; Path=/; ${maxAge}`,
      `accessToken=${encodeURIComponent(access_token)}; HttpOnly;${secure} SameSite=${sameSite}; Path=/; ${maxAge}`
    ]);

    // Redirection vers /api/setup (base optionnelle si tu as NEXT_PUBLIC_APP_URL)
    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const location = `${base}/api/setup`;
    res.writeHead(302, { Location: location });
    res.end();
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).json({ error: "OAuth callback error", details: String(err?.message || err) });
  }
}
