// api/setup.js
import path from "node:path";
import fs from "node:fs/promises";

// IMPORTANT : chemin relatif correct depuis /api -> /lib
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections,
} from "../lib/shopify.js";

// ---- Helpers REST pour Metafield Definitions (PRODUCT) ----
async function findDefinitionREST({ shop, accessToken, namespace, key }) {
  const url = new URL(`https://${shop}/admin/api/2024-10/metafield_definitions.json`);
  url.searchParams.set("owner_resource", "product");
  url.searchParams.set("namespace", namespace);

  const resp = await fetch(url, {
    headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`List metafield_definitions failed: ${resp.status}`);
  const data = await resp.json();
  return (data.metafield_definitions || []).find(d => d.namespace === namespace && d.key === key) || null;
}

async function createDefinitionREST({ shop, accessToken, name, namespace, key, type, description }) {
  const resp = await fetch(`https://${shop}/admin/api/2024-10/metafield_definitions.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      metafield_definition: {
        name,
        namespace,
        key,
        type,                       // e.g. "single_line_text_field"
        description,
        owner_types: ["product"],   // IMPORTANT: défini pour les produits
        visible_to_storefront: true
      }
    })
  });

  // 422 si déjà existant → on ignore
  if (resp.status === 422) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Create metafield_definition failed: ${resp.status} ${text}`);
  }
  return await resp.json();
}

async function upsertProductMetafields({ shop, accessToken }) {
  const defs = [
    { name: "Checkbox 1", namespace: "custom", key: "checkbox_1", type: "single_line_text_field", description: "Case à cocher 1 (texte court)" },
    { name: "Checkbox 2", namespace: "custom", key: "checkbox_2", type: "single_line_text_field", description: "Case à cocher 2 (texte court)" },
    { name: "Checkbox 3", namespace: "custom", key: "checkbox_3", type: "single_line_text_field", description: "Case à cocher 3 (texte court)" },
  ];

  for (const def of defs) {
    const exists = await findDefinitionREST({ shop, accessToken, namespace: def.namespace, key: def.key });
    if (!exists) {
      await createDefinitionREST({ shop, accessToken, ...def });
    }
  }
}

// -----------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");

    // Vérifie que les fichiers seed existent (pour éviter un 500 silencieux)
    await fs.access(csvPath);
    await fs.access(filesJsonPath);

    // 1) Metafields (idempotent)
    await upsertProductMetafields({ shop, accessToken });

    // 2) Import produits depuis CSV
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Upload images depuis /public/seed (selon files.json)
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir: seedDir });

    // 4) Pages
    await upsertPage({ shop, accessToken, handle: "livraison", title: "Livraison", html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>" });
    await upsertPage({ shop, accessToken, handle: "faq",       title: "FAQ",       html: "<h1>FAQ</h1><p>Questions fréquentes…</p>" });

    // 5) Menu FR
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections par tags (ton helper existant s’en occupe)
    await createCollections({ shop, accessToken });

    // Redirection vers une page “done” (facultatif), sinon renvoie OK
    const doneUrl = (process.env.NEXT_PUBLIC_APP_URL || "") + "/setup/done";
    res.writeHead(302, { Location: doneUrl });
    res.end();
  } catch (err) {
    console.error("SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
