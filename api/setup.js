// api/setup.js
import path from "node:path";
import { fileURLToPath } from "node:url";

// NOTE: chemins relatifs depuis /api vers /lib
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections, // si jamais ce helper pose souci, on créera les 2 collections ci-dessous à la main (déjà codé)
} from "../lib/shopify.js";

// -----------------------------
// Utils
// -----------------------------
function getCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  raw.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function shopifyGraphQLEndpoint(shop) {
  // Version admin stable ; si un jour tu changes, garde un numéro récent
  return `https://${shop}/admin/api/2024-10/graphql.json`;
}

async function gql(shop, accessToken, query, variables) {
  const r = await fetch(shopifyGraphQLEndpoint(shop), {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json();
  if (j.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(j.errors)}`);
  }
  return j.data;
}

// 1) Metafield definitions (PRODUCT): Checkbox 1/2/3
async function ensureProductMetafieldDefinitions(shop, accessToken) {
  const defs = [
    { name: "Checkbox 1", key: "checkbox_1" },
    { name: "Checkbox 2", key: "checkbox_2" },
    { name: "Checkbox 3", key: "checkbox_3" }
  ];

  const upsertMutation = `
    mutation metafieldDefinitionUpsert($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionUpsert(definition: $definition) {
        createdDefinition { id }
        updatedDefinition { id }
        userErrors { field message }
      }
    }
  `;

  for (const def of defs) {
    const variables = {
      definition: {
        name: def.name,
        namespace: "custom",
        key: def.key,
        type: "single_line_text_field",
        ownerType: "PRODUCT",
        description: def.name
        // NOTE: ne pas mettre visibleToStorefront ici (certains schémas l’ignorent/erreur)
      }
    };

    const data = await gql(shop, accessToken, upsertMutation, variables);
    const out = data.metafieldDefinitionUpsert;
    if (out.userErrors && out.userErrors.length) {
      const msg = out.userErrors.map(e => e.message).join("; ");
      throw new Error(`metafieldDefinitionUpsert ${def.key}: ${msg}`);
    }
  }
}

// 6) Smart collections basées sur des tags (idempotent, REST)
// - "Beauté & soins"
// - "Maison & confort"
async function ensureSmartCollections(shop, accessToken) {
  const api = `https://${shop}/admin/api/2024-10`;
  // Vérifie si déjà présentes (par titre)
  const existingResp = await fetch(`${api}/smart_collections.json?limit=250`, {
    headers: { "X-Shopify-Access-Token": accessToken }
  });
  if (!existingResp.ok) throw new Error(`List smart_collections failed: ${existingResp.status}`);
  const existing = (await existingResp.json()).smart_collections || [];

  const wanted = [
    { title: "Beauté & soins", tag: "Beauté & soins" },
    { title: "Maison & confort", tag: "Maison & confort" }
  ];

  for (const w of wanted) {
    const already = existing.find(c => c.title === w.title);
    if (already) continue;

    const body = {
      smart_collection: {
        title: w.title,
        rules: [
          { column: "tag", relation: "equals", condition: w.tag }
        ],
        disjunctive: false,
        published: true
      }
    };

    const create = await fetch(`${api}/smart_collections.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!create.ok) {
      const t = await create.text();
      throw new Error(`Create smart_collection "${w.title}" failed: ${create.status} ${t}`);
    }
  }
}

// -----------------------------
// Endpoint
// -----------------------------
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const cookies = getCookies(req);
    const shop = cookies.shop;
    const accessToken = cookies.accessToken;

    if (!shop || !accessToken) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
    }

    // Résoudre chemins seed
    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 1) Metafields (Checkbox 1/2/3)
    await ensureProductMetafieldDefinitions(shop, accessToken);

    // 2) Produits CSV
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Fichiers/Images
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 4) Pages
    await upsertPage({
      shop, accessToken, handle: "livraison", title: "Livraison",
      html: `<h1>Livraison GRATUITE</h1>
<p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
<ul>
  <li>France : 4-10 jours ouvrables</li>
  <li>Belgique: 4-10 jours ouvrables</li>
  <li>Suisse : 7-12 jours ouvrables</li>
  <li>Canada : 7-12 jours ouvrables</li>
  <li>Reste du monde : 7-14 jours</li>
</ul>`
    });

    await upsertPage({
      shop, accessToken, handle: "faq", title: "FAQ",
      html: `<h1>FAQ</h1><p>Crée ta FAQ ici</p>`
    });

    // 5) Menu principal FR
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections intelligentes (tags)
    // -> si ton helper createCollections est sûr, tu peux le garder et commenter la ligne suivante.
    // await createCollections({ shop, accessToken });
    await ensureSmartCollections(shop, accessToken);

    // OK
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    res.writeHead(302, { Location: `${base}/setup/done` });
    res.end();
  } catch (err) {
    console.error("SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
