import {
  gqlAdmin,
  createProductCheckboxes,
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections
} from "../lib/shopify.js";

export default async function handler(req, res) {
  try {
    const shop = req.cookies.shop;
    const accessToken = req.cookies.accessToken;
    if (!shop || !accessToken) return res.status(400).json({ error: "Missing shop or accessToken" });

    // Base URL de ton déploiement (ex: https://auto-shopify-setup-...vercel.app)
    const baseUrl = `https://${req.headers.host}`;

    // 1) Metafields produit
    await createProductCheckboxes(shop, accessToken);

    // 2) Import produits (CSV public)
    const csvUrl = `${baseUrl}/seed/products.csv`;
    await importProductsFromCsv(shop, accessToken, csvUrl);

    // 3) Upload images (depuis files.json)
    const filesList = await fetch(`${baseUrl}/seed/files.json`).then(r=>r.json());
    // map -> ajoute l’URL absolue attendue par uploadAllImages
    const files = filesList.map(f => ({ filename: f.filename, url: `${baseUrl}${f.path}` }));
    await uploadAllImages(shop, accessToken, files);

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

    // 5) Menu
    await upsertMainMenuFR(shop, accessToken);

    // 6) Collections
    await createCollections(shop, accessToken);

    // Réponse finale
    return res.status(200).json({ ok: true, message: "Setup terminé ✅" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "setup_failed", detail: String(e?.message || e) });
  }
}
