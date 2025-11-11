// /api/setup/import-products.js
// Import "variant-based" idempotent : produits + variants + images + prix

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { shopifyAdminFetch, shopifyGraphQL } = require("../../lib/shopify");

// ---- Session : header/query/env pour éviter la console ----
function getSession(req) {
  // 1) Priorité : query/header (cas OAuth pendant l'install)
  const shop = (req.query && req.query.shop) || process.env.SHOP;
  const accessToken =
    (req.headers && req.headers["x-shopify-access-token"]) ||
    process.env.SHOPIFY_ADMIN_TOKEN;

  if (!shop || !accessToken) {
    throw new Error(
      "Session Shopify manquante. Fournis ?shop=<domain> et/ou l'en-tête x-shopify-access-token, ou configure SHOP / SHOPIFY_ADMIN_TOKEN en variables d'environnement Vercel."
    );
  }
  return { shop, accessToken };
}

// ---- Helpers ----
function readCSV() {
  const csvPath = path.join(process.cwd(), "public", "seed", "products.csv");
  const buf = fs.readFileSync(csvPath);
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function groupByHandle(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.handle) continue;
    map.set(r.handle, [...(map.get(r.handle) || []), r]);
  }
  return map;
}

function firstNonEmpty(...arr) {
  for (const v of arr) if (v != null && String(v).trim() !== "") return v;
  return undefined;
}

function buildOptions(rows) {
  const base = rows[0] || {};
  const names = [base.option1_name, base.option2_name, base.option3_name]
    .filter(Boolean)
    .map(String);
  return names.map((name) => ({ name }));
}

function buildVariantFromRow(r) {
  return {
    sku: firstNonEmpty(r.sku),
    price: firstNonEmpty(r.price) ? String(r.price) : undefined,
    compare_at_price: firstNonEmpty(r.compare_at_price)
      ? String(r.compare_at_price)
      : undefined,
    option1: firstNonEmpty(r.option1_value),
    option2: firstNonEmpty(r.option2_value),
    option3: firstNonEmpty(r.option3_value),
    // enlève inventory_management si tu ne veux pas gérer le stock via Shopify
    inventory_management: "shopify",
  };
}

function buildVariants(rows) {
  return rows.map(buildVariantFromRow);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function buildImages(rows) {
  const srcs = uniq(
    rows.map((r) => r.image_src).filter((s) => s && String(s).trim() !== "")
  );
  return srcs.map((src) => ({ src }));
}

function gidToIdNum(gid) {
  return Number(String(gid).split("/").pop());
}

async function productIdByHandle(shop, token, handle) {
  const data = await shopifyGraphQL(
    shop,
    token,
    `query($h:String!){ productByHandle(handle:$h){ id } }`,
    { h: handle }
  );
  return (data && data.productByHandle && data.productByHandle.id) || null;
}

async function getProductVariants(shop, token, productIdNum) {
  const r = await shopifyAdminFetch(
    shop,
    token,
    `/products/${productIdNum}/variants.json?limit=250`
  );
  return r.variants || [];
}

async function getProductImages(shop, token, productIdNum) {
  const r = await shopifyAdminFetch(
    shop,
    token,
    `/products/${productIdNum}/images.json?limit=250`
  );
  return r.images || [];
}

function matchVariantByOptions(existingVariants, v) {
  return existingVariants.find(
    (e) =>
      (e.option1 || null) === (v.option1 || null) &&
      (e.option2 || null) === (v.option2 || null) &&
      (e.option3 || null) === (v.option3 || null)
  );
}

// ---- Handler ----
module.exports = async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    const { shop, accessToken } = getSession(req);

    const rows = readCSV();
    const groups = groupByHandle(rows);

    const results = [];

    for (const [handle, lines] of groups.entries()) {
      const base = lines[0];

      const gqlId = await productIdByHandle(shop, accessToken, handle);

      if (!gqlId) {
        // --- CREATE ---
        const payload = {
          product: {
            title: base.title,
            body_html: base.body_html || "",
            vendor: base.vendor || undefined,
            tags: base.tags || undefined,
            handle,
            options: buildOptions(lines),
            variants: buildVariants(lines),
            images: buildImages(lines),
            status: "active",
          },
        };
        const created = await shopifyAdminFetch(
          shop,
          accessToken,
          `/products.json`,
          { method: "POST", body: JSON.stringify(payload) }
        );
        results.push({
          handle,
          action: "created",
          id: created.product && created.product.id,
        });
        continue;
      }

      // --- UPDATE / UPSERT ---
      const productIdNum = gidToIdNum(gqlId);

      // 1) Met à jour les champs de base (sans casser la structure d’options)
      await shopifyAdminFetch(
        shop,
        accessToken,
        `/products/${productIdNum}.json`,
        {
          method: "PUT",
          body: JSON.stringify({
            product: {
              id: productIdNum,
              title: base.title,
              body_html: base.body_html || "",
              vendor: base.vendor || undefined,
              tags: base.tags || undefined,
            },
          }),
        }
      );

      // 2) Upsert variants : d’abord par SKU, sinon par (option1..3)
      const existingVariants = await getProductVariants(
        shop,
        accessToken,
        productIdNum
      );

      const bySku = new Map();
      for (const ev of existingVariants) if (ev.sku) bySku.set(ev.sku, ev);

      for (const v of buildVariants(lines)) {
        const match =
          (v.sku && bySku.get(v.sku)) ||
          matchVariantByOptions(existingVariants, v);

        if (match) {
          await shopifyAdminFetch(
            shop,
            accessToken,
            `/variants/${match.id}.json`,
            { method: "PUT", body: JSON.stringify({ variant: { id: match.id, ...v } }) }
          );
        } else {
          await shopifyAdminFetch(
            shop,
            accessToken,
            `/variants.json`,
            {
              method: "POST",
              body: JSON.stringify({ variant: { product_id: productIdNum, ...v } }),
            }
          );
        }
      }

      // 3) Images : on ajoute les nouvelles par src
      const existingImages = await getProductImages(
        shop,
        accessToken,
        productIdNum
      );
      const existingSrcs = new Set(existingImages.map((i) => i.src));
      for (const img of buildImages(lines)) {
        if (!existingSrcs.has(img.src)) {
          await shopifyAdminFetch(
            shop,
            accessToken,
            `/products/${productIdNum}/images.json`,
            { method: "POST", body: JSON.stringify({ image: img }) }
          );
        }
      }

      results.push({ handle, action: "updated", id: productIdNum });
    }

    // -------- Sortie : JSON ou petite page HTML pour tester au navigateur --------
    const payload = { ok: true, count: results.length, results };

    if (req.query && req.query.html === "1") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).end(`
        <html>
          <head><meta charset="utf-8"><title>Import produits</title>
          <style>
            body{font-family: ui-sans-serif, system-ui; padding:24px}
            pre{background:#111;color:#eee;padding:16px;border-radius:8px;overflow:auto}
          </style>
          </head>
          <body>
            <h1>Import produits – résultat</h1>
            <p>Boutique: <strong>${shop}</strong></p>
            <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
          </body>
        </html>
      `);
      return;
    }

    res.status(200).json(payload);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (req.query && req.query.html === "1") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res
        .status(500)
        .end(
          `<html><body><h1>Erreur</h1><pre>${escapeHtml(msg)}</pre></body></html>`
        );
      return;
    }
    res.status(500).json({ ok: false, error: msg });
  }
};

// Petit utilitaire pour l’affichage HTML
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
