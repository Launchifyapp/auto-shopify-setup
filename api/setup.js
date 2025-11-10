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

    // Construit l’URL absolue vers ton dossier public/seed
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const csvUrl = `${baseUrl}/seed/products.csv`;
    const filesListUrl = `${baseUrl}/seed/files.json`;

    // 1) Metafields produit
    await createProductCheckboxes(shop, accessToken);

    // 2) Import produits depuis ton CSV public
    await importProductsFromCsv(shop, accessToken, csvUrl);

    // 3) Upload des fichiers listés dans files.json
    //    Ton files.json contient { filename, path } → on le transforme en { filename, url }
    let files = [];
    try {
      const raw = await fetch(filesListUrl).then(r => r.json());
      files = (raw || []).map(f => ({
        filename: f.filename,
        url: `${baseUrl}${f.path}` // ex: https://.../seed/image1.jpg
      }));
    } catch (e) {
      // si pas de files.json, on ignore
      files = [];
    }
    if (files.length) {
      await uploadAllImages(shop, accessToken, files);
    }

    // 4) Pages “Livraison” + “FAQ”
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
    await upsertMai
