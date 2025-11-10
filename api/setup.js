// api/setup.js
import path from "node:path";
import fs from "node:fs/promises";

// 👇 adapte ce chemin si nécessaire (de /api -> /lib)
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections,
} from "../lib/shopify.js"; // IMPORTANT: chemin relatif correct depuis /api

// --------- helpers locaux ---------

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...v] = part.split("=");
    if (!k) continue;
    out[k.trim()] = decodeURIComponent((v.join("=") || "").trim());
  }
  return out;
}

// Upsert de définitions de metafields PRODUIT (GraphQL Admin API)
async function upsertProductMetafieldDefinitions({ shop, accessToken, definitions }) {
  const endpoint = `https://${shop}/admin/api/2024-10/graphql.json`;
  const mutation = `
    mutation metafieldDefinitionUpsert($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionUpsert(definition: $definition) {
        createdDefinition { id name namespace key type }
        updatedDefinition { id name namespace key type }
        userErrors { field message }
      }
    }
  `;

  for (const def of definitions) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          definition: {
            name: def.name,
            namespace: def.namespace,
            key: def.key,
            type: def.type,
            ownerType: "PRODUCT",
            visibleToStorefront: true,
            // description, validations… au besoin
          },
        },
      }),
    });

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    const errs = json.data?.metafieldDefinitionUpsert?.userErrors;
    if (errs?.length) {
      const msg = errs.map(e => e.message).join("; ");
      throw new Error(`Metafield upsert error for ${def.namespace}.${def.key}: ${msg}`);
    }
  }
}

const PRODUCT_METAFIELDS = [
  { name: "Sous-titre", namespace: "custom", key: "subtitle", type: "single_line_text_field" },
  { name: "USP",        namespace: "custom", key: "usp",      type: "list.single_line_text_field" },
  { name: "Vidéo",      namespace: "custom", key: "video",    type: "url" },
];

// --------- handler ---------

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Cookies (Vercel functions n’exposent pas req.cookies par défaut)
    const cookies = parseCookies(req.headers.cookie || "");
    const shop = cookies.shop;
    const accessToken = cookies.accessToken;

    if (!shop || !accessToken) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
    }

    // Chemins seed
    const seedDir = path.join(process.cwd(), "public", "seed");
    // Sanity check (évite surprises de bundle)
    try {
      await fs.access(seedDir);
    } catch {
      return res.status(500).json({ ok: false, error: `Seed folder not found at ${seedDir}` });
    }

    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 1) Metafields produit
    await upsertProductMetafieldDefinitions({ shop, accessToken, definitions: PRODUCT_METAFIELDS });

    // 2) Import CSV produits
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Upload images (via files.json + images dans /public/seed)
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 4) Pages
    await upsertPage({
      shop, accessToken, handle: "livraison", title: "Livraison",
      html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>"
    });
    await upsertPage({
      shop, accessToken, handle: "faq", title: "FAQ",
      html: "<h1>FAQ</h1><p>Questions fréquentes…</p>"
    });

    // 5) Menu principal FR
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections intelligentes par tags
    await createCollections({ shop, accessToken });

    // Redirection finale
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    const location = `${base}/setup/done`;
    res.writeHead(302, { Location: location });
    res.end();
  } catch (err) {
    console.error("SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
