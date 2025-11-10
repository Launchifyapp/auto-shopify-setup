// lib/shopify.js
import fs from "node:fs/promises";
import Papa from "papaparse";

// Petit helper REST Admin
async function shopifyRequest(shop, accessToken, path, method = "GET", body) {
  const url = `https://${shop}/admin/api/2024-10${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${method} ${path} failed: ${res.status} ${txt}`);
  }
  return res.json();
}

/**
 * Import Shopify CSV standard (une ligne par variante).
 * - Groupe par "Handle" pour éviter un produit par variante
 * - Crée options & variantes
 * - Attache les images via URL (Shopify les télécharge)
 */
export async function importProductsFromCsv({ shop, accessToken, csvPath }) {
  // 1) Lire le CSV depuis /public/seed/products.csv
  const csv = await fs.readFile(csvPath, "utf8");

  // 2) Parser
  const { data: rows, errors } = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim()
  });
  if (errors?.length) {
    throw new Error("CSV parse errors: " + errors.map(e => e.message).join(", "));
  }
  if (!rows.length) return { created: 0 };

  // 3) Grouper par handle
  const byHandle = new Map();
  for (const r of rows) {
    const handle = (r.Handle || r.handle || "").trim();
    if (!handle) continue;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle).push(r);
  }

  let created = 0;

  for (const [handle, group] of byHandle.entries()) {
    const first = group[0];

    // Champs produit de base
    const product = {
      title: first.Title || first["Product Name"] || "Untitled",
      body_html: first["Body (HTML)"] || first["Body"] || "",
      vendor: first.Vendor || "",
      product_type: first.Type || first["Product Category"] || "",
      tags: (first.Tags || "").toString(),
      handle,
      status: (first.Published && String(first.Published).toLowerCase() === "true") ? "active" : "draft",
    };

    // Options (Option1/2/3 Name + values)
    const optNames = [
      (first["Option1 Name"] || "").trim(),
      (first["Option2 Name"] || "").trim(),
      (first["Option3 Name"] || "").trim(),
    ].filter(Boolean);

    if (optNames.length === 0) {
      product.options = [{ name: "Title" }];
    } else {
      product.options = optNames.map(name => ({ name }));
    }

    // Variantes
    const variants = [];
    for (const r of group) {
      const v = {
        price: r["Variant Price"] || r["Price"] || undefined,
        sku: r["Variant SKU"] || r["SKU"] || undefined,
        compare_at_price: r["Variant Compare At Price"] || undefined,
        taxable: (r["Variant Taxable"] || "").toString().toLowerCase() === "true",
        inventory_management: r["Variant Inventory Tracker"] || undefined,
        barcode: r["Variant Barcode"] || undefined,
        grams: r["Variant Grams"] ? Number(r["Variant Grams"]) : undefined,
        weight: r["Variant Weight"] ? Number(r["Variant Weight"]) : undefined,
        weight_unit: r["Variant Weight Unit"] || undefined,
      };

      if (optNames.length === 0) {
        // Pas d’options => valeur par défaut
        v.option1 = "Default Title";
      } else {
        v.option1 = r["Option1 Value"] || null;
        if (optNames.length > 1) v.option2 = r["Option2 Value"] || null;
        if (optNames.length > 2) v.option3 = r["Option3 Value"] || null;
      }

      variants.push(v);
    }

    // Images produit (URLs uniques) depuis "Image Src" et "Variant Image"
    const imageSet = new Set();
    for (const r of group) {
      const img = (r["Image Src"] || r["Variant Image"] || "").trim();
      if (img) imageSet.add(img);
    }
    const images = [...imageSet].map(src => ({ src }));

    // Assemblage final
    const payload = { product: { ...product, variants, images } };

    // 4) Création produit
    await shopifyRequest(shop, accessToken, `/products.json`, "POST", payload);
    created++;
  }

  return { created };
}
