// /api/setup.js
import path from "node:path";
import fs from "node:fs/promises";

// ⚠️ adapte ce chemin si besoin : ton lib est à /lib/shopify.js
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections,
} from "../lib/shopify.js";

/**
 * --- HELPERS METAFIELDS (REST) ---
 * Shopify REST: POST /admin/api/2024-10/metafield_definitions.json
 * Docs: https://shopify.dev/docs/api/admin-rest/2024-10/resources/metafielddefinition
 */

async function findDefinition({ shop, accessToken, namespace, key }) {
  // Filtre par namespace & key & owner_resource=product
  const url = new URL(`https://${shop}/admin/api/2024-10/metafield_definitions.json`);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("key", key);
  url.searchParams.set("owner_resource", "product");

  const r = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`List metafield_definitions failed: ${r.status} ${body}`);
  }

  const json = await r.json();
  return (json.metafield_definitions || [])[0] || null;
}

async function createDefinition({ shop, accessToken, name, namespace, key, type, description }) {
  const url = `https://${shop}/admin/api/2024-10/metafield_definitions.json`;
  const payload = {
    metafield_definition: {
      name,
      namespace,
      key,
      type, // e.g. "single_line_text_field"
      owner_resource: "product",
      description: description || undefined,
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Create metafield_definition failed: ${r.status} ${body}`);
  }

  const json = await r.json();
  return json.metafield_definition;
}

async function ensureProductMetafieldDefinitions({ shop, accessToken, definitions, dryRun = false }) {
  const results = [];
  for (const def of definitions) {
    const existing = await findDefinition({
      shop,
      accessToken,
      namespace: def.namespace,
      key: def.key,
    });

    if (existing) {
      results.push({ action: "skip", key: `${def.namespace}.${def.key}`, id: existing.id });
      continue;
    }

    if (dryRun) {
      results.push({ action: "would_create", key: `${def.namespace}.${def.key}` });
      continue;
    }

    const created = await createDefinition({
      shop,
      accessToken,
      name: def.name,
      namespace: def.namespace,
      key: def.key,
      type: def.type,
      description: def.description,
    });

    results.push({ action: "created", key: `${def.namespace}.${def.key}`, id: created.id });
  }
  return results;
}

// --- tes définitions
const PRODUCT_METAFIELDS = [
  { name: "Checkbox 1", namespace: "custom", key: "checkbox_1", type: "single_line_text_field" },
  { name: "Checkbox 2", namespace: "custom", key: "checkbox_2", type: "single_line_text_field" },
  { name: "Checkbox 3", namespace: "custom", key: "checkbox_3", type: "single_line_text_field" },
];

// --- collections par tags (simple & explicite)
async function ensureSmartCollectionsByTags({ shop, accessToken, tags = [], dryRun = false }) {
  const results = [];

  // Helper REST
  const listCollections = async () => {
    const url = `https://${shop}/admin/api/2024-10/smart_collections.json?limit=250`;
    const r = await fetch(url, { headers: { "X-Shopify-Access-Token": accessToken } });
    if (!r.ok) throw new Error(`List smart_collections failed: ${r.status}`);
    const json = await r.json();
    return json.smart_collections || [];
  };

  const createCollection = async (title, tag) => {
    const url = `https://${shop}/admin/api/2024-10/smart_collections.json`;
    const payload = {
      smart_collection: {
        title,
        rules: [
          {
            column: "tag",
            relation: "equals",
            condition: tag,
          },
        ],
        rule_set: {
          applied_disjunctively: false, // AND
        },
        disjunctive: false, // legacy flag pour compat
        published: true,
      },
    };
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Create smart_collection failed: ${r.status} ${body}`);
    }
    return (await r.json()).smart_collection;
  };

  const existing = await listCollections();

  for (const tag of tags) {
    const title = tag; // simple: même libellé
    const already = existing.find((c) => (c.title || "").trim().toLowerCase() === title.trim().toLowerCase());
    if (already) {
      results.push({ action: "skip", title, id: already.id });
      continue;
    }
    if (dryRun) {
      results.push({ action: "would_create", title });
      continue;
    }
    const created = await createCollection(title, tag);
    results.push({ action: "created", title, id: created.id });
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
    }

    const dryRun = String(req.query?.dry ?? "") === "1";
    const only = String(req.query?.only ?? ""); // pour exécuter une seule étape
    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // Liste d'étapes (ré-entrantes)
    const steps = {
      metafields: async () =>
        await ensureProductMetafieldDefinitions({ shop, accessToken, definitions: PRODUCT_METAFIELDS, dryRun }),
      products: async () => await importProductsFromCsv({ shop, accessToken, csvPath, dryRun }),
      images: async () => await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir, dryRun }),
      pages: async () => {
        if (dryRun) return [{ action: "would_upsert_pages", handles: ["livraison", "faq"] }];
        await upsertPage({
          shop,
          accessToken,
          handle: "livraison",
          title: "Livraison",
          html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>",
        });
        await upsertPage({
          shop,
          accessToken,
          handle: "faq",
          title: "FAQ",
          html: "<h1>FAQ</h1><p>Questions fréquentes…</p>",
        });
        return [{ action: "upserted_pages", handles: ["livraison", "faq"] }];
      },
      menu: async () => (dryRun ? [{ action: "would_update_menu_main_fr" }] : await upsertMainMenuFR({ shop, accessToken })),
      collections: async () =>
        await ensureSmartCollectionsByTags({
          shop,
          accessToken,
          tags: ["Beauté & soins", "Maison & confort"],
          dryRun,
        }),
    };

    // Mode "pas à pas"
    if (only) {
      if (!steps[only]) return res.status(400).json({ ok: false, error: `Unknown step '${only}'` });
      const data = await steps[only]();
      return res.status(200).json({ ok: true, step: only, dryRun, data });
    }

    // Mode “tout” (séquentiel)
    const out = {};
    out.metafields = await steps.metafields();
    out.products = await steps.products();
    out.images = await steps.images();
    out.pages = await steps.pages();
    out.menu = await steps.menu();
    out.collections = await steps.collections();

    // Si c'est appelé depuis callback: redirige vers une page de fin
    const shouldRedirect = String(req.query?.redirect ?? "1") === "1" && !dryRun;
    if (shouldRedirect) {
      const base = process.env.NEXT_PUBLIC_APP_URL || "";
      const doneUrl = `${base}/setup/done`;
      res.writeHead(302, { Location: doneUrl });
      return res.end();
    }

    return res.status(200).json({ ok: true, dryRun, result: out });
  } catch (err) {
    console.error("SETUP ERROR", err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
