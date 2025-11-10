// lib/shopify.js
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import fetch from "node-fetch";

/**
 * Lit le CSV Shopify et retourne un tableau { handle, title, bodyHtml, vendor, productType, tags, published, images, variants }
 * - Groupe toutes les lignes par Handle
 * - Construit les variants (SKU, price, options)
 * - Construit les images (depuis "Image Src" ou "Variant Image")
 * - Si "Image Src" contient juste un nom de fichier (ex: image1.jpg), on le resolv via fileUrlMap (clé = filename)
 */
async function readProductsFromCsv(csvPath, fileUrlMap = {}) {
  const buf = await fs.readFile(csvPath);
  const records = parse(buf, { columns: true, skip_empty_lines: true });

  // group by Handle
  const byHandle = new Map();
  for (const row of records) {
    const handle = (row["Handle"] || "").trim();
    if (!handle) continue;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle).push(row);
  }

  const products = [];
  for (const [handle, rows] of byHandle.entries()) {
    const first = rows[0];

    const product = {
      handle,
      title: first["Title"] || "",
      bodyHtml: first["Body (HTML)"] || "",
      vendor: first["Vendor"] || "",
      productType: first["Type"] || first["Product Category"] || "",
      tags: (first["Tags"] || "").split(",").map(t => t.trim()).filter(Boolean),
      published: String(first["Published"] || "").toLowerCase() !== "false",
      images: [],
      variants: []
    };

    // Images produit (colonnes Shopify: Image Src, Image Position, Variant Image)
    const imageRows = rows.filter(r => (r["Image Src"] && r["Image Src"].trim()) || (r["Variant Image"] && r["Variant Image"].trim()));
    const imageSet = new Set();
    for (const r of imageRows) {
      const candidates = [r["Image Src"], r["Variant Image"]].filter(Boolean);
      for (let src of candidates) {
        src = src.trim();
        if (!src) continue;
        // si c'est seulement un nom de fichier, map -> URL uploadée
        if (!/^https?:\/\//i.test(src)) {
          const fname = path.basename(src);
          if (fileUrlMap[fname]) src = fileUrlMap[fname];
        }
        if (!imageSet.has(src)) {
          imageSet.add(src);
          product.images.push({ src });
        }
      }
    }

    // Variantes
    for (const r of rows) {
      // Shopify CSV: Option1 Name/Value, Option2 Name/Value, Option3 Name/Value
      const options = [];
      for (let i = 1; i <= 3; i++) {
        const name = r[`Option${i} Name`];
        const value = r[`Option${i} Value`];
        if (name && value) {
          options.push({ name: String(name), value: String(value) });
        }
      }

      // Certaines lignes de "produit parent" n'ont pas de variant, on les ignore si aucune info variant
      const hasVariantSignal =
        r["Variant SKU"] || r["Variant Price"] || r["Variant Grams"] || options.length;

      if (!hasVariantSignal) continue;

      // prix
      const price = r["Variant Price"] ? String(r["Variant Price"]).trim() : undefined;

      // image dédiée à la variante ?
      let imageSrc = (r["Variant Image"] || "").trim();
      if (imageSrc && !/^https?:\/\//i.test(imageSrc)) {
        const fname = path.basename(imageSrc);
        if (fileUrlMap[fname]) imageSrc = fileUrlMap[fname];
      }

      product.variants.push({
        sku: r["Variant SKU"] || undefined,
        price,
        options,
        imageSrc: imageSrc || undefined
      });
    }

    // S'il n'y a aucune variante détectée, créer une variante par défaut
    if (product.variants.length === 0) {
      product.variants.push({ sku: undefined, price: undefined, options: [] });
    }

    products.push(product);
  }

  return products;
}

/**
 * Vérifie si un produit existe déjà par handle
 */
async function findProductIdByHandle({ shop, accessToken, handle }) {
  const endpoint = `https://${shop}/admin/api/2024-10/graphql.json`;
  const query = `
    query($handle: String!) {
      productByHandle(handle: $handle) { id }
    }
  `;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables: { handle } })
  });
  const j = await r.json();
  return j?.data?.productByHandle?.id || null;
}

/**
 * Crée un produit avec variants + images
 */
async function createProduct({ shop, accessToken, product }) {
  const endpoint = `https://${shop}/admin/api/2024-10/graphql.json`;
  const mutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product { id handle title }
        userErrors { field message }
      }
    }
  `;

  // transforme nos données en ProductInput Shopify
  const input = {
    title: product.title || product.handle,
    handle: product.handle,
    bodyHtml: product.bodyHtml || undefined,
    vendor: product.vendor || undefined,
    productType: product.productType || undefined,
    tags: product.tags,
    status: product.published ? "ACTIVE" : "DRAFT",
    images: product.images?.length ? product.images.map(i => ({ src: i.src })) : undefined,
    variants: product.variants.map(v => ({
      sku: v.sku || undefined,
      price: v.price || undefined,
      // Les options s'écrivent via selectedOptions [{name,value}]
      selectedOptions: v.options?.length ? v.options.map(o => ({ name: o.name, value: o.value })) : undefined,
      imageSrc: v.imageSrc || undefined
    }))
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: mutation, variables: { input } })
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(`GraphQL error: ${JSON.stringify(j.errors)}`);
  const errs = j?.data?.productCreate?.userErrors;
  if (errs?.length) throw new Error(`productCreate errors: ${errs.map(e => e.message).join("; ")}`);
}

/**
 * Upload des fichiers (images) — déjà codé chez toi mais on renvoie une map filename->url
 * Ici, on part du principe que tu as déjà une fonction uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir })
 * qui renvoie { "<filename>": "<absolute_url_on_cdn>" }
 * Si la tienne ne renvoie rien, adapte-la pour retourner cet objet.
 */
export async function importProductsFromCsvGrouped({ shop, accessToken, csvPath, fileUrlMap = {} }) {
  const products = await readProductsFromCsv(csvPath, fileUrlMap);

  for (const p of products) {
    const existing = await findProductIdByHandle({ shop, accessToken, handle: p.handle });
    if (existing) {
      // idempotent: si déjà là, on skip (on pourrait faire un update plus tard)
      continue;
    }
    await createProduct({ shop, accessToken, product: p });
  }

  return { ok: true, created: products.length };
}

/* ====== Tu as déjà ces helpers, je laisse les stubs pour contexte. ====== */
export async function uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir }) {
  // Doit renvoyer une map: { "image1.jpg": "https://cdn.shopify.com/.../image1.jpg", ... }
  // Si ton implémentation actuelle ne renvoie rien, modifie-la pour renvoyer cette map.
  throw new Error("uploadAllImages non implémenté ici (utilise ta version et retourne une map filename->url).");
}

export async function upsertPage() { /* ... */ }
export async function upsertMainMenuFR() { /* ... */ }
export async function createCollections() { /* ... */ }
