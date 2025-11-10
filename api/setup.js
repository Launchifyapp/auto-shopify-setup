// api/setup.js
import path from "node:path";

// ⚠️ Imports de tes helpers existants
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections, // si tu préfères la logique maison; sinon on crée ci-dessous 2 collections basées sur les tags
} from "../lib/shopify.js";

// ---- Petites helpers REST Admin API (simple et robuste)
const API_VERSION = "2024-04"; // version stable REST

async function shopifyREST({ shop, accessToken, method, path: restPath, body }) {
  const url = `https://${shop}/admin/api/${API_VERSION}${restPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${restPath} failed: ${res.status} ${text}`);
  }
  return res.json().catch(() => ({}));
}

// ---- 1) Metafield Definitions (REST) → idempotent
async function ensureProductMetafieldDefinition({ shop, accessToken, namespace, key, name, description, type }) {
  // Cherche si ça existe déjà
  const q = new URLSearchParams({
    owner_type: "product",
    namespace,
    key,
    limit: "1",
  }).toString();

  const list = await shopifyREST({
    shop,
    accessToken,
    method: "GET",
    path: `/metafield_definitions.json?${q}`,
  });

  const found = Array.isArray(list.metafield_definitions) && list.metafield_definitions[0];
  if (found) return { created: false, id: found.id };

  // Crée si absent
  const payload = {
    metafield_definition: {
      name,
      namespace,
      key,
      type, // ex: "single_line_text_field"
      owner_type: "product",
      description,
      // visible_to_storefront n'existe pas côté REST definition
    },
  };

  const created = await shopifyREST({
    shop,
    accessToken,
    method: "POST",
    path: `/metafield_definitions.json`,
    body: payload,
  });

  return { created: true, id: created?.metafield_definition?.id };
}

// ---- 6) Collections intelligentes basées sur tags (simple)
async function ensureSmartCollectionByTag({ shop, accessToken, title, tag }) {
  // Essaie de retrouver par titre
  const q = new URLSearchParams({ title, limit: "1" }).toString();
  const list = await shopifyREST({
    shop,
    accessToken,
    method: "GET",
    path: `/smart_collections.json?${q}`,
  });

  if (Array.isArray(list.smart_collections) && list.smart_collections.length > 0) {
    return { created: false, id: list.smart_collections[0].id };
  }

  // Crée une smart collection "Produits taggés <tag>"
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
      disjunctive: false, // ET si plusieurs règles; ici on en a une seule
      published: true,
    },
  };

  const created = await shopifyREST({
    shop,
    accessToken,
    method: "POST",
    path: `/smart_collections.json`,
    body: payload,
  });

  return { created: true, id: created?.smart_collection?.id };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    const log = [];

    // 1) Metafield definitions (Checkbox 1/2/3)
    const defs = [
      { namespace: "custom", key: "checkbox_1", name: "Checkbox 1", description: "Case à cocher #1", type: "single_line_text_field" },
      { namespace: "custom", key: "checkbox_2", name: "Checkbox 2", description: "Case à cocher #2", type: "single_line_text_field" },
      { namespace: "custom", key: "checkbox_3", name: "Checkbox 3", description: "Case à cocher #3", type: "single_line_text_field" },
    ];
    for (const d of defs) {
      const r = await ensureProductMetafieldDefinition({ shop, accessToken, ...d });
      log.push({ step: "metafield_definition", key: `${d.namespace}.${d.key}`, result: r });
    }

    // 2) Import produits CSV
    const prodRes = await importProductsFromCsv({ shop, accessToken, csvPath });
    log.push({ step: "import_products_csv", result: prodRes ?? "ok" });

    // 3) Upload images
    const imgRes = await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });
    log.push({ step: "upload_imag_
