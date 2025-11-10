// lib/shopify.js
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import fetch from "node-fetch";

const API_VERSION = "2024-10";

async function shopifyFetch(shop, accessToken, url, options = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}${url}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${options.method || "GET"} ${url} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Vérifie s'il existe déjà un produit avec ce titre (simple, suffisant pour un seed).
async function findProductByTitle(shop, accessToken, title) {
  const q = encodeURIComponent(title);
  const data = await shopifyFetch(shop, accessToken, `/products.json?title=${q}&limit=5`);
  const hit = (data.products || []).find(p => (p.title || "").trim() === title.trim());
  return hit || null;
}

export async function importProductsFromCsv({ shop, accessToken, csvPath }) {
  const abs = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  const raw = await fs.readFile(abs, "utf8");

  // Parse robuste
  const records = parse(raw, {
    columns: true,           // 1ère ligne = headers
    skip_empty_lines: true,  // ignore lignes vides
    bom: true,               // gère BOM éventuel
    trim: true
  });

  // Normalisation & filtrage
  const rows = records
    .map(r => {
      // harmonise des noms de colonnes fréquents
      const Title = r.Title || r.title || r.NAME || "";
      const Price = r.Price || r.price || r["Variant Price"] || "";
      return {
        Title: (Title || "").trim(),
        Body: (r.Body || r["Body (HTML)"] || r.Description || "").trim(),
        Price: (Price || "").toString().trim(),
        Tags: (r.Tags || r.tags || "").toString().trim(),
        // On ignore les colonnes images pour l’instant
      };
    })
    .filter(r => r.Title.length > 0); // indispensable pour éviter les "produits sans titre"

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const row of rows) {
    // Evite les doublons par Titre
    const existing = await findProductByTitle(shop, accessToken, row.Title);
    const payload = {
      product: {
        title: row.Title,
        body_html: row.Body || undefined,
        tags: row.Tags || undefined,
        variants: row.Price ? [{ price: row.Price }] : [{}],
        // images: [] // on gèrera plus tard
      }
    };

    if (existing) {
      // (option simple) on skippe pour le moment pour éviter les surprises
      skipped++;
      continue;

      // Si tu préfères updater au lieu de skipper, dé-commente ça :
      // await shopifyFetch(shop, accessToken, `/products/${existing.id}.json`, {
      //   method: "PUT",
      //   body: JSON.stringify(payload)
      // });
      // updated++;
      // continue;
    }

    await shopifyFetch(shop, accessToken, `/products.json`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    created++;
  }

  return { created, skipped, updated, totalRows: rows.length };
}
