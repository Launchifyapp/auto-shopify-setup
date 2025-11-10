import path from "node:path";
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  // ⚠️ on NE touche pas aux metafields ici
  // createCollections  => on l'ajoutera plus tard
} from "../lib/shopify.js";

// petit parseur de cookies robuste
function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").filter(Boolean).map(p => {
      const i = p.indexOf("=");
      const k = decodeURIComponent(p.slice(0, i).trim());
      const v = decodeURIComponent(p.slice(i + 1).trim());
      return [k, v];
    })
  );
}

export default async function handler(req, res) {
  try {
    // 1) cookies shop + accessToken
    const cookies = parseCookies(req.headers.cookie || "");
    const shop = cookies.shop;
    const accessToken = cookies.accessToken;
    if (!shop || !accessToken) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
    }

    // 2) chemins des seeds
    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 3) Import produits CSV
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 4) Upload images
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 5) Pages
    await upsertPage({
      shop,
      accessToken,
      handle: "livraison",
      title: "Livraison",
      html: `
        <h1>Livraison GRATUITE</h1>
        <p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition.
        Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
        <ul>
          <li>France : 4-10 jours ouvrables</li>
          <li>Belgique : 4-10 jours ouvrables</li>
          <li>Suisse : 7-12 jours ouvrables</li>
          <li>Canada : 7-12 jours ouvrables</li>
          <li>Reste du monde : 7-14 jours</li>
        </ul>
      `.trim()
    });

    await upsertPage({
      shop,
      accessToken,
      handle: "faq",
      title: "FAQ",
      html: `<h1>FAQ</h1><p>« Crée ta FAQ ici »</p>`
    });

    // 6) Menu principal FR
    // Si ton helper accepte des entrées, on passe la structure souhaitée ;
    // sinon il peut gérer en interne (idempotent) :
    await upsertMainMenuFR({
      shop,
      accessToken,
      menu: [
        { title: "Accueil",     type: "HOME" },                     // Page d’accueil
        { title: "Nos produits",type: "ALL_PRODUCTS" },             // Tous les produits
        { title: "Livraison",   type: "PAGE", handle: "livraison" },
        { title: "FAQ",         type: "PAGE", handle: "faq" },
        { title: "Contact",     type: "CONTACT" }
      ]
    });

    // 🔜 Les collections par tags viendront plus tard (prochaine étape).

    return res.status(200).json({ ok: true, steps: ["products", "files", "pages", "menu"] });
  } catch (err) {
    console.error("SETUP-LITE ERROR", err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
