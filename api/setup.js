import { gqlAdmin } from "../lib/shopify";

export default async function handler(req, res) {
  const shop = req.cookies.shop;
  const accessToken = req.cookies.accessToken;

  if (!shop || !accessToken) {
    return res.status(400).json({ error: "Missing shop or accessToken" });
  }

  const gql = gqlAdmin(shop, accessToken);

  // Test simple pour vérifier que la connexion à Shopify fonctionne
  const data = await gql(`{ shop { name } }`);

  return res.status(200).json({
    ok: true,
    message: `Setup connecté ✅ Boutique : ${data.shop.name}`
  });
}
