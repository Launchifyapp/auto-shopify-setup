// /api/install?shop=xxx.myshopify.com
import crypto from "node:crypto";

export default async function handler(req, res) {
  const { shop } = req.query;
  if (!shop || !shop.endsWith(".myshopify.com")) {
    return res.status(400).send("Paramètre 'shop' manquant ou invalide (xxx.myshopify.com).");
  }

  const scopes = process.env.SCOPES || "write_products,write_themes,write_content,write_online_store_navigation";
  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = `${process.env.APP_URL}/api/callback`;

  // Anti-CSRF
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(
    clientId
  )}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${encodeURIComponent(state)}&grant_options[]=`;

  // Petite page avec lien (pratique si tu ouvres sans query) :
  return res.status(200).send(
    `<html><body style="font-family:system-ui">
      <h3>Installer l'app sur ${shop}</h3>
      <p><a href="${authUrl}">👉 Continuer l'installation</a></p>
    </body></html>`
  );
}
