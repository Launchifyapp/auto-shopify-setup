// lib/shopify.js
// NOTE: tu as déjà d'autres fonctions ici ; garde-les.
// J'ajoute des helpers REST simples et idempotents.

const API_VERSION = "2024-10"; // garde une version cohérente partout

function adminRest(shop, accessToken, path, init = {}) {
  return fetch(`https://${shop}/admin/api/${API_VERSION}/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
      ...(init.headers || {})
    }
  });
}

// ---------- 1) Metafield Definitions (REST) ----------
export async function upsertProductMetafieldDefinitionsREST({ shop, accessToken, definitions }) {
  // 1. lister les définitions existantes pour ne pas recréer
  const existing = await listProductMetafieldDefinitionsREST({ shop, accessToken });
  const keyMap = new Map(existing.map(d => [`${d.namespace}.${d.key}`, d]));

  for (const def of definitions) {
    const idKey = `${def.namespace}.${def.key}`;
    if (keyMap.has(idKey)) {
      // Facultatif : tu peux faire un update si tu veux (REST: PUT /metafield_definitions/{id}.json)
      continue;
    }

    const body = {
      metafield_definition: {
        name: def.name,                       // "Checkbox 1"
        namespace: def.namespace,             // "custom"
        key: def.key,                         // "checkbox_1"
        type: def.type,                       // "single_line_text_field"
        description: def.description || "",
        owner_types: ["product"]
      }
    };

    const res = await adminRest(shop, accessToken, `metafield_definitions.json`, {
      method: "POST",
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Create metafield_definition failed: ${res.status} ${t}`);
    }
  }
}

async function listProductMetafieldDefinitionsREST({ shop, accessToken }) {
  // NB: Shopify REST utilise ?owner_type=product
  const res = await adminRest(shop, accessToken, `metafield_definitions.json?owner_type=product`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`List metafield_definitions failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.metafield_definitions || [];
}

// ---------- 2) Smart Collections par tags (REST) ----------
export async function ensureSmartCollectionsByTags({ shop, accessToken, tags }) {
  // On crée 1 collection par tag avec une règle "tag equals <tag>"
  // Idempotence: on cherche par title avant de créer
  const existing = await listSmartCollections({ shop, accessToken });

  for (const tag of tags) {
    const title = tag; // même nom que le tag
    if (existing.some(c => c.title === title)) continue;

    const body = {
      smart_collection: {
        title,
        rules: [
          { column: "tag", relation: "equals", condition: tag }
        ],
        disjunctive: false // AND
      }
    };

    const res = await adminRest(shop, accessToken, `smart_collections.json`, {
      method: "POST",
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Create smart_collection "${title}" failed: ${res.status} ${t}`);
    }
  }
}

async function listSmartCollections({ shop, accessToken }) {
  const res = await adminRest(shop, accessToken, `smart_collections.json?limit=250`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`List smart_collections failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.smart_collections || [];
}
