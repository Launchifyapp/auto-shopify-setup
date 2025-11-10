// api/setup.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections // si tu as déjà quelque chose, on peut le laisser
} from "../lib/shopify.js";

// --------- util cookies ----------
function getCookieFromHeader(header, name) {
  if (!header) return null;
  const cookies = header.split(";").map(c => c.trim());
  for (const c of cookies) {
    const [k, ...rest] = c.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// --------- GraphQL helpers ----------
function adminGraphQLEndpoint(shop) {
  return `https://${shop}/admin/api/2024-10/graphql.json`;
}

async function gql(shop, accessToken, query, variables) {
  const r = await fetch(adminGraphQLEndpoint(shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await r.json();
  if (!r.ok || json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

// Vérifie si une metafield definition existe déjà
async function findDefinition(shop, accessToken, { namespace, key }) {
  const q = `
    query ($owner: MetafieldOwnerType!, $namespace: String!, $key: String!) {
      metafieldDefinitions(first: 1, ownerType: $owner, namespace: $namespace, key: $key) {
        edges { node { id namespace key name type } }
      }
    }
  `;
  const data = await gql(shop, accessToken, q, {
    owner: "PRODUCT",
    namespace,
    key
  });
  const edge = data.metafieldDefinitions.edges[0];
  return edge?.node || null;
}

// Crée ou met à jour une metafield definition (PRODUCT)
async function upsertProductDefinition(shop, accessToken, def) {
  const current = await findDefinition(shop, accessToken, def);

  if (!current) {
    const mutationCreate = `
      mutation ($def: MetafieldDefinitionCreateInput!) {
        metafieldDefinitionCreate(definition: $def) {
          createdDefinition { id namespace key type name }
          userErrors { field message }
        }
      }
    `;
    const res = await gql(shop, accessToken, mutationCreate, {
      def: {
        name: def.name,
        namespace: def.namespace,
        key: def.key,
        type: def.type,              // ex: "single_line_text_field"
        description: def.description || null,
        ownerType: "PRODUCT",
        validations: def.validations || []
      }
    });
    const errs = res.metafieldDefinitionCreate.userErrors;
    if (errs?.length) throw new Error(`Create metafield definition failed: ${JSON.stringify(errs)}`);
    return res.metafieldDefinitionCreate.createdDefinition;
  } else {
    const mutationUpdate = `
      mutation ($id: ID!, $upd: MetafieldDefinitionUpdateInput!) {
        metafieldDefinitionUpdate(id: $id, definition: $upd) {
          updatedDefinition { id namespace key type name }
          userErrors { field message }
        }
      }
    `;
    const res = await gql(shop, accessToken, mutationUpdate, {
      id: current.id,
      upd: {
        name: def.name,
        description: def.description || null,
        validations: def.validations || []
      }
    });
    const errs = res.metafieldDefinitionUpdate.userErrors;
    if (errs?.length) throw new Error(`Update metafield definition failed: ${JSON.stringify(errs)}`);
    return res.metafieldDefinitionUpdate.updatedDefinition;
  }
}

// Idempotent: crée 3 metafields "Checkbox 1/2/3" texte simple
async function ensureProductMetafields(shop, accessToken) {
  const defs = [
    { name: "Checkbox 1", namespace: "custom", key: "checkbox_1", type: "single_line_text_field" },
    { name: "Checkbox 2", namespace: "custom", key: "checkbox_2", type: "single_line_text_field" },
    { name: "Checkbox 3", namespace: "custom", key: "checkbox_3", type: "single_line_text_field" }
  ];
  for (const d of defs) {
    await upsertProductDefinition(shop, accessToken, d);
  }
}

// --------- Smart collections par tags ----------
async function ensureSmartCollection(shop, accessToken, { title, tagEquals, handle }) {
  // Vérifie si la collection existe déjà par handle
  const getQ = `
    query($handle: String!) {
      collection(handle: $handle) { id handle title }
    }
  `;
  const exists = await gql(shop, accessToken, getQ, { handle }).catch(() => null);
  if (exists?.collection) return exists.collection;

  // Création via REST Admin (smart_collections)
  const endpoint = `https://${shop}/admin/api/2024-10/smart_collections.json`;
  const payload = {
    smart_collection: {
      title,
      handle,
      rules: [
        { column: "tag", relation: "equals", condition: tagEquals }
      ],
      published: true
    }
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Create smart collection failed: ${r.status}`);
  return (await r.json()).smart_collection;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const cookieHeader = req.headers.cookie || "";
    const shop = getCookieFromHeader(cookieHeader, "shop");
    const accessToken = getCookieFromHeader(cookieHeader, "accessToken");
    if (!shop || !accessToken) return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 1) Metafields produit
    await ensureProductMetafields(shop, accessToken);

    // 2) Produits depuis CSV
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Upload images (lit files.json + images dans /public/seed)
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 4) Pages Livraison & FAQ
    await upsertPage({ shop, accessToken, handle: "livraison", title: "Livraison", html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>" });
    await upsertPage({ shop, accessToken, handle: "faq",       title: "FAQ",       html: "<h1>FAQ</h1><p>Questions fréquentes…</p>" });

    // 5) Menu principal FR
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections intelligentes par tags (simplifié – 2 collections)
    await ensureSmartCollection(shop, accessToken, {
      title: "Beauté & soins",
      tagEquals: "Beauté & soins",
      handle: "beaute-et-soins"
    });
    await ensureSmartCollection(shop, accessToken, {
      title: "Maison & confort",
      tagEquals: "Maison & confort",
      handle: "maison-et-confort"
    });

    // (Optionnel) si tu gardes ton helper:
    if (typeof createCollections === "function") {
      try { await createCollections({ shop, accessToken }); } catch { /* ignore si déjà géré */ }
    }

    // Redirige vers une page "done" si tu veux, sinon répond ok
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
