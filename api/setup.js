// api/setup.js
import path from "node:path";

// ⚠️ On importe tes helpers *si* présents. Sinon, on continue sans planter.
let helpers = {};
try {
  helpers = await import("../lib/shopify.js");
} catch (e) {
  console.warn("lib/shopify.js introuvable ou non importable, on continue sans :", e?.message);
}

// Utils REST + GraphQL
function shopifyRest(shop, token, pathname, init = {}) {
  return fetch(`https://${shop}/admin/api/2024-10${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
      ...(init.headers || {})
    }
  });
}

function shopifyGraphql(shop, token, query, variables) {
  return fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
}

// === Étape 1 : Definitions de metafields PRODUIT (create or update)
async function ensureProductMetafieldDefinitions({ shop, token }) {
  const defs = [
    { name: "Checkbox 1", namespace: "custom", key: "checkbox_1", type: "single_line_text_field" },
    { name: "Checkbox 2", namespace: "custom", key: "checkbox_2", type: "single_line_text_field" },
    { name: "Checkbox 3", namespace: "custom", key: "checkbox_3", type: "single_line_text_field" }
  ];

  const results = [];

  for (const def of defs) {
    // 1) Existe déjà ?
    const q = `
      query defs($first: Int!, $namespace: String!, $key: String!) {
        metafieldDefinitions(first: $first, ownerType: PRODUCT, namespace: $namespace, key: $key) {
          edges { node { id name namespace key type { name } } }
        }
      }
    `;
    const foundRes = await shopifyGraphql(shop, token, q, { first: 1, namespace: def.namespace, key: def.key });
    const foundJson = await foundRes.json();
    if (foundJson.errors) throw new Error("GraphQL error: " + JSON.stringify(foundJson.errors));
    const existing = foundJson?.data?.metafieldDefinitions?.edges?.[0]?.node;

    if (!existing) {
      // 2) Create
      const m = `
        mutation create($def: MetafieldDefinitionCreateInput!) {
          metafieldDefinitionCreate(definition: $def) {
            createdDefinition { id name namespace key }
            userErrors { field message }
          }
        }
      `;
      const resp = await shopifyGraphql(shop, token, m, {
        def: {
          name: def.name,
          namespace: def.namespace,
          key: def.key,
          type: def.type,
          ownerType: "PRODUCT",
          description: def.description || undefined
        }
      });
      const json = await resp.json();
      if (json.errors) throw new Error("GraphQL error: " + JSON.stringify(json.errors));
      const errs = json.data.metafieldDefinitionCreate.userErrors;
      if (errs?.length) throw new Error("Create metafield definition error: " + errs.map(e => e.message).join("; "));
      results.push({ action: "created", key: `${def.namespace}.${def.key}` });
    } else {
      // 3) Update (on peut mettre à jour le name/description)
      const m = `
        mutation update($id: ID!, $upd: MetafieldDefinitionUpdateInput!) {
          metafieldDefinitionUpdate(id: $id, definition: $upd) {
            updatedDefinition { id name }
            userErrors { field message }
          }
        }
      `;
      const resp = await shopifyGraphql(shop, token, m, {
        id: existing.id,
        upd: {
          name: def.name,
          description: def.description || undefined
          // NOTE: on ne change pas 'type' après création
        }
      });
      const json = await resp.json();
      if (json.errors) throw new Error("GraphQL error: " + JSON.stringify(json.errors));
      const errs = json.data.metafieldDefinitionUpdate.userErrors;
      if (errs?.length) throw new Error("Update metafield definition error: " + errs.map(e => e.message).join("; "));
      results.push({ action: "updated", key: `${def.namespace}.${def.key}` });
    }
  }

  return results;
}

// === Étape 4 : Upsert pages simples
async function upsertPage({ shop, token, handle, title, body_html }) {
  // GET par handle
  const list = await shopifyRest(shop, token, `/pages.json?handle=${encodeURIComponent(handle)}`);
  const data = await list.json();
  const existing = (data?.pages || []).find(p => p.handle === handle);

  if (existing) {
    const r = await shopifyRest(shop, token, `/pages/${existing.id}.json`, {
      method: "PUT",
      body: JSON.stringify({ page: { id: existing.id, title, body_html } })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Update page ${handle} failed: ${r.status} ${JSON.stringify(j)}`);
    return { action: "updated", id: j.page.id, handle };
  } else {
    const r = await shopifyRest(shop, token, `/pages.json`, {
      method: "POST",
      body: JSON.stringify({ page: { title, handle, body_html } })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Create page ${handle} failed: ${r.status} ${JSON.stringify(j)}`);
    return { action: "created", id: j.page.id, handle };
  }
}

// === Étape 6 : Smart collections par tags (simplifié)
async function ensureSmartCollectionByTag({ shop, token, title, tag }) {
  // Vérifie si une smart collection du même titre existe
  const list = await shopifyRest(shop, token, `/smart_collections.json?title=${encodeURIComponent(title)}`);
  const data = await list.json();
  const existing = (data?.smart_collections || []).find(c => c.title === title);

  const payload = {
    smart_collection: {
      title,
      rules: [{ column: "tag", relation: "equals", condition: tag }],
      disjunctive: false
    }
  };

  if (existing) {
    const r = await shopifyRest(shop, token, `/smart_collections/${existing.id}.json`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Update smart collection "${title}" failed: ${r.status} ${JSON.stringify(j)}`);
    return { action: "updated", id: j.smart_collection.id, title };
  } else {
    const r = await shopifyRest(shop, token, `/smart_collections.json`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Create smart collection "${title}" failed: ${r.status} ${JSON.stringify(j)}`);
    return { action: "created", id: j.smart_collection.id, title };
  }
}

export default async function handler(req, res) {
  try {
    const shop = req.cookies?.shop;
    const token = req.cookies?.accessToken;
    if (!shop || !token) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
    }

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");

    const out = { steps: [] };

    // 1) Metafield definitions
    out.steps.push({ name: "metafield_definitions", result: await ensureProductMetafieldDefinitions({ shop, token }) });

    // 2) Import produits (si helper présent)
    if (typeof helpers.importProductsFromCsv === "function") {
      out.steps.push({ name: "import_products", result: await helpers.importProductsFromCsv({ shop, accessToken: token, csvPath }) });
    } else {
      out.steps.push({ name: "import_products", skipped: true });
    }

    // 3) Upload images (si helper présent)
    if (typeof helpers.uploadAllImages === "function") {
      out.steps.push({ name: "upload_images", result: await helpers.uploadAllImages({ shop, accessToken: token, filesJsonPath, imagesDir: seedDir }) });
    } else {
      out.steps.push({ name: "upload_images", skipped: true });
    }

    // 4) Pages Livraison & FAQ
    out.steps.push({ name: "page_livraison", result: await upsertPage({
      shop, token, handle: "livraison", title: "Livraison",
      body_html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>"
    })});
    out.steps.push({ name: "page_faq", result: await upsertPage({
      shop, token, handle: "faq", title: "FAQ",
      body_html: "<h1>FAQ</h1><p>Questions fréquentes…</p>"
    })});

    // 5) Menu principal FR (si helper présent)
    if (typeof helpers.upsertMainMenuFR === "function") {
      out.steps.push({ name: "menu_fr", result: await helpers.upsertMainMenuFR({ shop, accessToken: token }) });
    } else {
      out.steps.push({ name: "menu_fr", skipped: true });
    }

    // 6) Collections intelligentes par tags
    const col1 = await ensureSmartCollectionByTag({ shop, token, title: "Beauté & soins", tag: "Beauté & soins" });
    const col2 = await ensureSmartCollectionByTag({ shop, token, title: "Maison & confort", tag: "Maison & confort" });
    out.steps.push({ name: "collections", result: [col1, col2] });

    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    console.error("SETUP ERROR", err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
