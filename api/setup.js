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

    // Entrées possibles via POST body, sinon via ENV
    const {
      productsCsvUrl = process.env.PRODUCTS_CSV_URL || "",
      files = process.env.FILES_JSON ? JSON.parse(process.env.FILES_JSON) : [],
    } = req.method === "POST" ? (req.body || {}) : {};

    // 0) Ping
    const gql = gqlAdmin(shop, accessToken);
    const ping = await gql(`{ shop { name } }`);

    // 1) Metafields
    await createProductCheckboxes(shop, accessToken);

    // 2) Produits (CSV)
    if (productsCsvUrl) {
      await importProductsFromCsv(shop, accessToken, productsCsvUrl);
    }

    // 3) Fichiers
    if (files?.length) {
      await uploadAllImages(shop, accessToken, files);
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

    // 5) Menu FR
    await upsertMainMenuFR(shop, accessToken);

    // 6) Collections
    await createCollections(shop, accessToken);

    return res.status(200).json({
      ok: true,
      shop: ping.shop.name,
      steps: {
        metafields: "done",
        productsCsv: productsCsvUrl ? "done" : "skipped",
        files: files?.length ? "done" : "skipped",
        pages: "done",
        menu: "done",
        collections: "done",
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
