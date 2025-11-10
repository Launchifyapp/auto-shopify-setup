// api/setup.js
import path from "node:path";
import fs from "node:fs/promises";

// ⚠️ IMPORT RELATIF car projet Vercel Functions (pas d'alias @)
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections,
} from "../lib/shopify.js";

// --- utils ---
function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map(v => v.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return acc;
      acc[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
      return acc;
    }, {});
}

// --- Shopify GraphQL helpers (inline pour éviter tout import manquant) ---
async function shopifyGraphQL({ shop, accessToken, query, variables }) {
  const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

// Vérifie si une définition existe déjà
async function metafieldDefinitionExists({ shop, accessToken, namespace, key }) {
  const q = `
    query ($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
      metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) {
        edges { node { id } }
      }
    }
  `;
  const data = await shopifyGraphQL({
    shop,
    accessToken,
    query: q,
    variables: { ownerType: "PRODUCT", namespace, key },
  });
  return (data.metafieldDefinitions?.edges?.[0]?.node?.id) || null;
}

// Crée la définition si manquante
async function ensureProductMetafieldDefinition({ shop, accessToken, name, namespace, key, type, visibleToStorefront = true, description }) {
  const existingId = await metafieldDefinitionExists({ shop, accessToken, namespace, key });
  if (existingId) return existingId;

  const mutation = `
    mutation metafieldDefinitionCreate($def: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $def) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }
  `;

  const data = await shopifyGraphQL({
    shop,
    accessToken,
    query: mutation,
    variables: {
      def: {
        name,
        namespace,
        key,
        type,                // e.g. "single_line_text_field", "url", "boolean", "list.single_line_text_field"
        ownerType: "PRODUCT",
        visibleToStorefront,
        description,
      },
    },
  });

  const errs = data?.metafieldDefinitionCreate?.userErrors;
  if (errs && errs.length) {
    // si "already_exists" on ignore, sinon on jette
    const already = errs.find(e => String(e.code).toLowerCase().includes("already"));
    if (!already) {
      throw new Error(`metafieldDefinitionCreate error for ${namespace}.${key}: ${errs.map(e => e.message).join("; ")}`);
    }
  }
  return data?.metafieldDefinitionCreate?.createdDefinition?.id || existingId;
}

const PRODUCT_METAFIELDS = [
  { name: "Sous-titre", namespace: "custom", key: "subtitle", type: "single_line_text_field", description: "Sous-titre court du produit." },
  { name: "USP",        namespace: "custom", key: "usp",      type: "list.single_line_text_field", description: "Liste de bénéfices clés." },
  { name: "Vidéo",      namespace: "custom", key: "video",    type: "url", description: "URL vidéo de présentation." },
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    // cookies (Vercel Functions n'ajoute pas req.cookies)
    const cookies = parseCookies(req.headers.cookie || "");
    const shop = cookies.shop;
    const accessToken = cookies.accessToken;

    if (!shop || !accessToken) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
    }

    // chemins /public/seed
    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");

    // sanity check (évite un 500 silencieux si oubli de commit)
    await fs.access(csvPath);
    await fs.access(filesJsonPath);

    // 1) Metafield Definitions (idempotent)
    for (const def of PRODUCT_METAFIELDS) {
      await ensureProductMetafieldDefinition({ shop, accessToken, ...def });
    }

    // 2) Import produits CSV
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Upload images selon files.json
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir: seedDir });

    // 4) Pages
    await upsertPage({ shop, accessToken, handle: "livraison", title: "Livraison", html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>" });
    await upsertPage({ shop, accessToken, handle: "faq",       title: "FAQ",       html: "<h1>FAQ</h1><p>Questions fréquentes…</p>" });

    // 5) Menu principal
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections intelligentes
    await createCollections({ shop, accessToken });

    // Redirection finale (personnalise l’URL)
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    res.writeHead(302, { Location: `${base}/setup/done` });
    res.end();
  } catch (err) {
    console.error("SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
