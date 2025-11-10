// api/setup.js
import path from "node:path";
import fs from "node:fs/promises";

/** Util REST Shopify */
function shopifyFetch({ shop, accessToken, path: p, method = "GET", body }) {
  const url = `https://${shop}/admin/api/2024-10${p}`;
  return fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

/** 1) Upsert des metafield definitions PRODUIT (REST) */
async function upsertProductMetafieldDefinitions({ shop, accessToken, definitions }) {
  for (const def of definitions) {
    // Existe déjà ?
    const q = new URLSearchParams({
      owner_type: "product",
      namespace: def.namespace,
      key: def.key
    }).toString();

    const listRes = await shopifyFetch({
      shop, accessToken, path: `/metafield_definitions.json?${q}`
    });

    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error(`List metafield_definitions failed: ${listRes.status} ${t}`);
    }

    const { metafield_definitions = [] } = await listRes.json();
    if (metafield_definitions.length > 0) {
      // déjà présent -> skip
      continue;
    }

    // Créer
    const createRes = await shopifyFetch({
      shop, accessToken, path: `/metafield_definitions.json`, method: "POST",
      body: {
        metafield_definition: {
          name: def.name,
          namespace: def.namespace,
          key: def.key,
          type: def.type,         // "single_line_text_field"
          description: def.description || undefined,
          owner_type: "product"   // important !
        }
      }
    });

    if (!createRes.ok) {
      const t = await createRes.text();
      throw new Error(`Create metafield_definition failed: ${createRes.status} ${t}`);
    }
  }
}

/** 6) Créer des smart collections par TAG (REST) */
async function ensureSmartCollectionByTag({ shop, accessToken, title, tag }) {
  // Vérifie si elle existe déjà (par titre)
  const list = await shopifyFetch({
    shop, accessToken, path: `/smart_collections.json?title=${encodeURIComponent(title)}&limit=1`
  });
  if (!list.ok) {
    const t = await list.text();
    throw new Error(`List smart_collections failed: ${list.status} ${t}`);
  }
  const { smart_collections = [] } = await list.json();
  if (smart_collections.length > 0) return; // déjà là

  // Crée une Smart Collection avec une règle "tag == <tag>"
  const create = await shopifyFetch({
    shop, accessToken, path: `/smart_collections.json`, method: "POST",
    body: {
      smart_collection: {
        title,
        rules: [
          { column: "tag", relation: "equals", condition: tag }
        ],
        disjunctive: false, // AND si plusieurs règles (ici une seule)
        published: true
      }
    }
  });
  if (!create.ok) {
    const t = await create.text();
    throw new Error(`Create smart_collection failed: ${create.status} ${t}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });

    // --- 1) Metafields produit : Checkbox 1/2/3
    await upsertProductMetafieldDefinitions({
      shop,
      accessToken,
      definitions: [
        { name: "Checkbox 1", namespace: "custom", key: "checkbox_1", type: "single_line_text_field" },
        { name: "Checkbox 2", namespace: "custom", key: "checkbox_2", type: "single_line_text_field" },
        { name: "Checkbox 3", namespace: "custom", key: "checkbox_3", type: "single_line_text_field" }
      ]
    });

    // --- 2) Import produits CSV
    // Appelle ton helper existant si présent.
    try {
      const { importProductsFromCsv } = await import("../lib/shopify.js");
      const seedDir = path.join(process.cwd(), "public", "seed");
      const csvPath = path.join(seedDir, "products.csv");
      await fs.access(csvPath); // vérifie que le fichier existe
      await importProductsFromCsv({ shop, accessToken, csvPath });
    } catch (e) {
      // si pas de helper dispo, on n'échoue pas l’ensemble
      console.warn("importProductsFromCsv skipped:", e.message);
    }

    // --- 3) Upload images (via ton helper s’il existe)
    try {
      const { uploadAllImages } = await import("../lib/shopify.js");
      const seedDir = path.join(process.cwd(), "public", "seed");
      const filesJsonPath = path.join(seedDir, "files.json");
      await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir: seedDir });
    } catch (e) {
      console.warn("uploadAllImages skipped:", e.message);
    }

    // --- 4) Créer pages Livraison & FAQ (via ton helper)
    try {
      const { upsertPage } = await import("../lib/shopify.js");
      await upsertPage({ shop, accessToken, handle: "livraison", title: "Livraison", html: "<h1>Livraison</h1><p>Détails de livraison…</p>" });
      await upsertPage({ shop, accessToken, handle: "faq",       title: "FAQ",       html: "<h1>FAQ</h1><p>Questions fréquentes…</p>" });
    } catch (e) {
      console.warn("upsertPage skipped:", e.message);
    }

    // --- 5) Menu principal FR (via ton helper)
    try {
      const { upsertMainMenuFR } = await import("../lib/shopify.js");
      await upsertMainMenuFR({ shop, accessToken });
    } catch (e) {
      console.warn("upsertMainMenuFR skipped:", e.message);
    }

    // --- 6) Collections intelligentes par tags (simple & débutant-friendly)
    //   - "Beauté & soins"
    //   - "Maison & confort"
    await ensureSmartCollectionByTag({
      shop, accessToken, title: "Beauté & soins", tag: "Beauté & soins"
    });
    await ensureSmartCollectionByTag({
      shop, accessToken, title: "Maison & confort", tag: "Maison & confort"
    });

    // Redirige vers une page “done” si tu veux, sinon renvoie ok
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("| SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
