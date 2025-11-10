// /api/setup.js
import {
  createProductCheckboxes,
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections,
} from "../lib/shopify";

const LIVRAISON_HTML = `
<h1>Livraison GRATUITE</h1>
<p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
<ul>
<li>France : 4-10 jours ouvrables</li>
<li>Belgique: 4-10 jours ouvrables</li>
<li>Suisse : 7-12 jours ouvrables</li>
<li>Canada : 7-12 jours ouvrables</li>
<li>Reste du monde : 7-14 jours</li>
</ul>
`;

const FAQ_HTML = `<h1>FAQ</h1><p>« Crée ta FAQ ici »</p>`;

export default async function handler(req, res) {
  const shop = req.cookies.shop;
  const accessToken = req.cookies.accessToken;
  if (!shop || !accessToken) {
    return res.status(400).json({ error: "Missing shop or accessToken" });
  }

  // Base URL de ton app
  const baseUrl = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

  // 1) Metafields produits
  await createProductCheckboxes(shop, accessToken);

  // 2) Import produits (depuis CSV local)
  await importProductsFromCsv(shop, accessToken, `${baseUrl}/seed/products.csv`);

  // 3) Upload des images (on lit ton files.json)
  try {
    const manifest = await fetch(`${baseUrl}/seed/files.json`).then(r => r.json());
    const images = manifest.map(file => ({
      filename: file.filename,
      url: `${baseUrl}${file.path}`
    }));
    await uploadAllImages(shop, accessToken, images);
  } catch (e) {
    console.warn("⚠️ files.json introuvable ou erreur lecture, on continue sans upload d'images");
  }

  // 4) Pages
  await upsertPage(shop, accessToken, "livraison", "Livraison", LIVRAISON_HTML);
  await upsertPage(shop, accessToken, "faq", "FAQ", FAQ_HTML);

  // 5) Menu principal
  await upsertMainMenuFR(shop, accessToken);

  // 6) Collections
  await createCollections(shop, accessToken);

  return res.status(200).json({ ok: true, message: "Setup terminé ✅" });
}
