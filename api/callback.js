// Shopify -> /api/callback?shop=&code=&state=&hmac=...
import crypto from "node:crypto";
import fetch from "node-fetch";

function verifyHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  return digest === hmac;
}

async function exchangeToken(shop, code, clientId, clientSecret) {
  const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
  });
  if (!resp.ok) throw new Error(`Access token error: ${resp.status}`);
  return resp.json(); // { access_token, scope }
}

async function getGrantedScopes(shop, accessToken) {
  const r = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
    headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" }
  });
  return r.json(); // { access_scopes: [{handle:"write_products"}, ...] }
}

export default async function handler(req, res) {
  try {
    const { shop, code, state } = req.query;
    if (!shop || !code) return res.status(400).send("Paramètres manquants.");

    // 1) Vérifier l'HMAC
    const ok = verifyHmac(req.query, process.env.SHOPIFY_API_SECRET);
    if (!ok) return res.status(400).send("HMAC invalide.");

    // 2) Échanger le code contre un token
    const { access_token } = await exchangeToken(
      shop,
      code,
      process.env.SHOPIFY_API_KEY,
      process.env.SHOPIFY_API_SECRET
    );

    // 3) Vérifier les scopes réellement accordés (log)
    const scopes = await getGrantedScopes(shop, access_token);
    console.log("✅ Boutique installée:", shop);
    console.log("✅ Scopes accordés:", scopes);

    // 4) TODO: lancer l'onboarding (thème, pages, produits, menus)
    // -> Ici tu appelleras un "job" qui fera:
    //    - importTheme(shop, access_token)
    //    - createPages(...)
    //    - createProducts(pack20|pack40, ...)
    //    - createCollections(...)
    //    - createMenus(...)
    // Pour le moment on affiche juste une page de succès.

    const adminUrl = `https://${shop}/admin`;
    return res.status(200).send(
      `<html><body style="font-family:system-ui">
        <h2>Installation réussie 🎉</h2>
        <p>Vous pouvez retourner sur l’admin Shopify : <a href="${adminUrl}">${adminUrl}</a></p>
        <p>Vous recevrez un email quand la boutique est prête (une fois l'onboarding automatisé branché).</p>
      </body></html>`
    );
  } catch (e) {
    console.error(e);
    return res.status(500).send("Erreur pendant le callback.");
  }
}
