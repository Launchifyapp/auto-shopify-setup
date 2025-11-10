// api/setup.js
import path from "node:path";

// IMPORTANT : chemin relatif vers ton helper déjà existant
// Vu ta structure (/api et /lib sont au même niveau)
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections
} from "../lib/shopify.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

// ---------------- Metafield Definitions (GraphQL) ----------------
async function upsertProductMetafieldDefinitions({ shop, accessToken, definitions }) {
  const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  const mutation = `
    mutation metafieldDefinitionUpsert($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionUpsert(definition: $definition) {
        createdDefinition { id name namespace key type ownerType }
        updatedDefinition { id name namespace key type ownerType }
        userErrors { field message code }
      }
    }
  `;

  for (const def of definitions) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
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
            description: def.description || undefined
            // NOTE: ne pas mettre visibleToStorefront ici (cause d'erreur sur ta boutique/version)
          }
        }
      })
    });

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    const errs = json.data?.metafieldDefinitionUpsert?.userErrors;
    if (errs?.length) {
      throw new Error(`GraphQL error: ${JSON.stringify(errs)}`);
    }
  }
}

// ---------------- Smart Collections par TAG (REST) ----------------
async function ensureSmartCollectionByTag({ shop, accessToken, title, tag }) {
  const base = `https://${shop}/admin/api/${API_VERSION}`;
  // 1) Cherche si elle existe déjà
  const listRes = await fetch(`${base}/smart_collections.json?title=${encodeURIComponent(title)}`, {
    headers: { "X-Shopify-Access-Token": accessToken }
  });
  if (!listRes.ok) {
    const txt = await listRes.text();
    throw new Error(`List smart_collections failed: ${listRes.status} ${txt}`);
  }
  const { smart_collections } = await listRes.json();
  if (smart_collections?.length) return; // déjà là

  // 2) Crée avec une règle "tag equals <tag>"
  const createRes = await fetch(`${base}/smart_collections.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      smart_collection: {
        title,
        rules: [
          { column: "tag", relation: "equals", condition: tag }
        ],
        disjunctive: false // ET sur plusieurs règles (ici on n'en met qu'une)
      }
    })
  });

  if (!createRes.ok) {
    const txt = await createRes.text();
    throw new Error(`Create smart_collection failed: ${createRes.status} ${txt}`);
  }
}

// ---------------- Handler ----------------
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;
    if (!shop || !accessToken) {
      return res.status(401).json({ ok: false, error: "Missing shop/accessToken cookie" });
    }

    const seedDir = path.join(process.cwd(), "public", "seed");
    const csvPath = path.join(seedDir, "products.csv");
    const filesJsonPath = path.join(seedDir, "files.json");
    const imagesDir = seedDir;

    // 1) Metafield product definitions (tes 3 checkboxes)
    const PRODUCT_METAFIELDS = [
      { name: "Checkbox 1", namespace: "custom", key: "checkbox1", type: "single_line_text_field" },
      { name: "Checkbox 2", namespace: "custom", key: "checkbox2", type: "single_line_text_field" },
      { name: "Checkbox 3", namespace: "custom", key: "checkbox3", type: "single_line_text_field" }
    ];
    await upsertProductMetafieldDefinitions({ shop, accessToken, definitions: PRODUCT_METAFIELDS });

    // 2) Import produits
    await importProductsFromCsv({ shop, accessToken, csvPath });

    // 3) Upload images
    await uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir });

    // 4) Pages
    await upsertPage({
      shop, accessToken,
      handle: "livraison",
      title: "Livraison",
      html: "<h1>Livraison</h1><p>Délais, transporteurs, coûts…</p>"
    });
    await upsertPage({
      shop, accessToken,
      handle: "faq",
      title: "FAQ",
      html: "<h1>FAQ</h1><p>Questions fréquentes…</p>"
    });

    // 5) Menu principal FR
    await upsertMainMenuFR({ shop, accessToken });

    // 6) Collections intelligentes par tags (simplifié)
    await ensureSmartCollectionByTag({
      shop, accessToken,
      title: "Beauté & soins",
      tag: "Beauté & soins"
    });
    await ensureSmartCollectionByTag({
      shop, accessToken,
      title: "Maison & confort",
      tag: "Maison & confort"
    });

    // (Optionnel) Si tu as déjà un helper createCollections, tu peux l'appeler ici aussi
    // await createCollections({ shop, accessToken });

    const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL || ""}/setup/done`;
    res.writeHead(302, { Location: redirectUrl });
    res.end();
  } catch (err) {
    console.error("SETUP ERROR", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
