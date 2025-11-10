// lib/metafields.js
// Upsert de metafield DEFINITIONS via l'Admin REST API (fiable et simple)

const API_VERSION = "2024-07"; // ou 2024-10 si tu préfères

async function shopifyRest(shop, accessToken, path, opts = {}) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${opts.method || "GET"} ${path} failed: ${res.status} ${text}`);
  }
  // Certaines routes renvoient 204 sans body
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Vérifie si une metafield definition existe (namespace+key) pour les produits.
 */
async function findProductDefinition(shop, accessToken, namespace, key) {
  const q = new URLSearchParams({ namespace, key, owner_types: "product" }).toString();
  const data = await shopifyRest(shop, accessToken, `/metafield/definitions.json?${q}`);
  const arr = data?.metafield_definitions || [];
  return arr.find(d => d.namespace === namespace && d.key === key && (d.owner_types || []).includes("product")) || null;
}

/**
 * Crée une metafield definition produit (single line text).
 * Idempotent: si ça existe déjà, on ne refait rien.
 */
async function upsertSingleLineTextProductDefinition(shop, accessToken, { name, namespace, key, description }) {
  const existing = await findProductDefinition(shop, accessToken, namespace, key);
  if (existing) return { created: false, definition: existing };

  const body = {
    metafield_definition: {
      name,
      namespace,
      key,
      type: "single_line_text_field",
      owner_types: ["product"],
      description: description || undefined
    }
  };

  const created = await shopifyRest(shop, accessToken, `/metafield/definitions.json`, {
    method: "POST",
    body
  });

  return { created: true, definition: created?.metafield_definition || null };
}

/**
 * Upsert en série des 3 cases à cocher (texte simple).
 */
export async function upsertThreeCheckboxMetafields({ shop, accessToken }) {
  const defs = [
    { name: "Checkbox 1", namespace: "custom", key: "checkbox_1" },
    { name: "Checkbox 2", namespace: "custom", key: "checkbox_2" },
    { name: "Checkbox 3", namespace: "custom", key: "checkbox_3" }
  ];

  const results = [];
  for (const def of defs) {
    // Description optionnelle, tu peux la retirer
    const r = await upsertSingleLineTextProductDefinition(shop, accessToken, {
      ...def,
      description: def.name
    });
    results.push({ key: def.key, created: r.created, id: r.definition?.id });
  }
  return results;
}
