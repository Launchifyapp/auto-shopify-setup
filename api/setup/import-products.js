// Next.js Pages Router API (serverless Vercel)
// Import "variant-based" idempotent depuis public/seed/products.csv

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { shopifyAdminFetch, shopifyGraphQL } from "../../../lib/shopify";

// ⚠️ Adapte à ta gestion de session OAuth existante si besoin.
// Ici: on lit shop dans ?shop= et le token dans l'header x-shopify-access-token.
async function getSession(req) {
  const shop = (req.query.shop || "").toString();
  const accessToken = (req.headers["x-shopify-access-token"] || "").toString();
  if (!shop || !accessToken) throw new Error("Session Shopify manquante");
  return { shop, accessToken };
}

function readCSVRows() {
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
    const handle = (r.handle || "").trim();
    if (!handle) continue;
    if (!map.has(handle)) map.set(handle, []);
    map.get(handle).push(r);
  }
  return map;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

// Construit l'objet "options" au format REST à partir de la 1ère ligne du groupe
function buildOptions(lines) {
  const first = lines[0] || {};
  const names = [first.option1_name, first.option2_name, first.option3_name]
    .filter(Boolean)
    .map((s) => s.toString().trim());
  return names.map((name) => ({ name }));
}

// Construit la liste des variants à partir de chaque ligne
function buildVariants(lines) {
  return lines.map((r) => ({
    sku: r.sku || undefined,
    price: r.price != null && r.price !== "" ? String(r.price) : undefined,
    compare_at_price:
      r.compare_at_price != null && r.compare_at_price !== ""
        ? String(r.compare_at_price)
        : undefined,
    option1: r.option1_value || undefined,
    option2: r.option2_value || undefined,
    option3: r.option3_value || undefined,
    // Ajuste si tu ne gères pas le stock via Shopify
    inventory_management: "shopify",
  }));
}

function buildImages(lines) {
  const srcs = uniq(
    lines.map((r) => (r.image_src || "").trim()).filter((s) => s.length > 0)
  );
  return srcs.map((src) => ({ src }));
}

function gidToNumericId(gid) {
  // "gid://shopify/Product/1234567890" -> 1234567890
  return Number(String(gid).split("/").pop());
}

async function productIdByHandle(shop, accessToken, handle) {
  const data = await shopifyGraphQL(
    shop,
    accessToken,
    `query($h:String!){ productByHandle(handle:$h){ id } }`,
    { h: handle }
  );
  return data && data.productByHandle ? data.productByHandle.id : null;
}

async function getProductVariants(shop, accessToken, productIdNum) {
  const resp = await shopifyAdminFetch(
    shop,
    accessToken,
    `/products/${productIdNum}/variants.json?limit=250`
  );
  return resp.variants || [];
}

async function getProductImages(shop, accessToken, productIdNum) {
  const resp = await shopifyAdminFetch(
    shop,
    accessToken,
    `/products/${productIdNum}/images.json?limit=250`
  );
  return resp.images || [];
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { shop, accessToken } = await getSession(req);
    const rows = readCSVRows();
    const groups = groupByHandle(rows);

    const results = [];

    for (const [handle, lines] of groups.entries()) {
      const base = lines[0] || {};
      const gqlId = await productIdByHandle(shop, accessToken, handle);

      if (!gqlId) {
        // CREATE produit + variants + images
        const payload = {
          product: {
            title: base.title || handle,
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
        results.push({ handle, action: "created", id: created.product.id });
        continue;
      }

      // UPDATE idempotent
      const productIdNum = gidToNumericId(gqlId);

      // 1) Maj champs de base (on ne touche pas aux options pour ne pas casser les variants existants)
      await shopifyAdminFetch(
        shop,
        accessToken,
        `/products/${productIdNum}.json`,
        {
          method: "PUT",
          body: JSON.stringify({
            product: {
              id: productIdNum,
              title: base.title || handle,
              body_html: base.body_html || "",
              vendor: base.vendor || undefined,
              tags: base.tags || undefined,
            },
          }),
        }
      );

      // 2) Upsert variants (par SKU si présent, sinon ajoute)
      const existingVariants = await getProductVariants(
        shop,
        accessToken,
        productIdNum
      );
      const bySku = new Map();
      for (const v of existingVariants) {
        if (v.sku) bySku.set(v.sku, v);
      }

      const desired = buildVariants(lines);
      for (const v of desired) {
        const match = v.sku ? bySku.get(v.sku) : undefined;
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
            { method: "POST", body: JSON.stringify({ variant: { product_id: productIdNum, ...v } }) }
          );
        }
      }

      // 3) Images : ajoute celles manquantes par src
      const existingImages = await getProductImages(
        shop,
        accessToken,
        productIdNum
      );
      const existingSrcs = new Set((existingImages || []).map((i) => i.src));
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

    res.status(200).json({ ok: true, count: results.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
