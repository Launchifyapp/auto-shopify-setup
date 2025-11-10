// /api/setup.js
import {
  gqlAdmin,
  createProductCheckboxes,
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections,
} from "../lib/shopify";

export default async function handler(req, res) {
  try {
    const shop = req.cookies.shop;
    const accessToken = req.cookies.accessToken;
    if (!shop || !accessToken) {
      return res.status(400).json({ error: "Missing shop or accessToken" });
    }

    // Base URL de ton déploiement (fonctionne en local et sur Vercel)
    const baseUrl = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

    // URLs publiques vers ton CSV et ton JSON (car dans /public/seed)
    const csvUrl = `${baseUrl}/seed/products.csv`;
    const filesJsonUrl = `${baseUrl}/seed/files.json`;

    // 0) Sanity check
    const gql = gqlAdmin(shop, accessToken);
    const data = await gql(`{ shop { name } }`);
    console.log("Seed → boutique:", data.shop.name);

    // 1) Metafields produit
    await createProductCheckboxes(shop, accessToken);

    // 2) Import produits (si products.csv existe)
    try {
      await importProductsFromCsv(shop, accessToken, csvUrl);
    } catch (e) {
      console.warn("Import CSV ignoré (fichier manquant ou invalide):", e.message);
    }

    // 3) Upload des images listées dans files.json
    try {
      const list = await fetch(filesJsonUrl).then(r => {
        if (!r.ok) throw new Error("files.json introuvable");
        return r.json();
      });
      // Ton files.json a { filename, path } → on fabrique une URL publique
      const files = (list || []).map(item => ({
        filename: item.filename,
        url: `${baseUrl}${item.path}`, // ex: /seed/image1.jpg
      }));
      await uploadAllImages(shop, accessToken, files);
    } catch (e) {
      console.warn("Upload images ignoré (files.json manquant ?):", e.message);
    }

    // 4) Pages
    const LIVRAISON_HTML = `
      <h1>Livraison GRATUITE</h1>
      <p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
      <ul>
      <li>France : 4-10 jours ouvrables</li>
      <li>Belgique: 4-10 jours ouvrables</li>
      <li>Suisse : 7-12 jours ouvrables</li>
      <li>Canada : 7-12 jours ouvrables</li>
      <li>Reste du monde : 7-14 jours</li>
      </ul>`;
    const FAQ_HTML = `<h1>FAQ</h1><p>« Crée ta FAQ ici »</p>`;

    await upsertPage(shop, accessToken, "livraison", "Livraison", LIVRAISON_HTML);
    await upsertPage(shop, accessToken, "faq", "FAQ", FAQ_HTML);

    // 5) Menu principal FR
    await upsertMainMenuFR(shop, accessToken);

    // 6) Smart collections
    await createCollections(shop, accessToken);

    return res.status(200).json({ ok: true, message: "Seed terminé ✅" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
