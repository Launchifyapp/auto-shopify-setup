// lib/shopify.js
import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";

/** Requête REST Shopify (petit helper) */
export async function shopifyRest(shop, accessToken, method, pathname, body) {
  const url = `https://${shop}/admin/api/2024-10${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${pathname} failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Transforme les valeurs 'TRUE'/'FALSE'/'true'/'false' en bool */
function toBool(v) {
  if (typeof v !== "string") return !!v;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return undefined;
}

/** Normalise le statut Shopify CSV -> API */
function toStatus(v) {
  const s = (v || "").toLowerCase();
  if (s === "active") return "active";
  if (s === "draft") return "draft";
  if (s === "archived") return "archived";
  return "active"; // défaut
}

/**
 * Importe un fichier CSV au format "Shopify Products CSV"
 * - Groupe par Handle
 * - Construit options/variants à partir de Option1/2/3 Name + Value
 * - Ajoute les images à partir de "Image Src" (URL)
 */
export async function importProductsFromCsv({ shop, accessToken, csvPath }) {
  // Résolution robuste du chemin (fonctionne sur Vercel)
  const abs = path.isAbsolute(csvPath)
    ? csvPath
    : path.join(process.cwd(), csvPath);

  if (!fs.existsSync(abs)) {
    throw new Error(`CSV not found at ${abs}`);
  }

  const csvBuffer = fs.readFileSync(abs);
  const records = parse(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
  });

  // --- Regroupement par handle ---
  const byHandle = new Map();
  for (const row of records) {
    const handle = row.Handle || row.handle || "";
    if (!handle) continue;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle).push(row);
  }

  let created = 0;
  const errors = [];

  for (const [handle, rows] of byHandle.entries()) {
    try {
      const first = rows[0];

      // Options (on ignore "Default Title")
      const optionNames = [first["Option1 Name"], first["Option2 Name"], first["Option3 Name"]]
        .filter(Boolean)
        .filter((n) => n !== "Default Title");

      const options = optionNames.map((name, idx) => ({
        name,
        position: idx + 1,
      }));

      // Variants
      const variants = rows.map((r) => {
        const values = [
          r["Option1 Value"],
          r["Option2 Value"],
          r["Option3 Value"],
        ].filter((v, i) => optionNames[i]); // garde seulement si option existe

        // Shopify demande des variants si options existent
        // si aucune option => on met un variant unique "Default Title"
        const variant = {
          sku: r["Variant SKU"] || undefined,
          price: r["Variant Price"] || undefined,
          compare_at_price: r["Variant Compare At Price"] || undefined,
          taxable: toBool(r["Variant Taxable"]),
          requires_shipping: toBool(r["Variant Requires Shipping"]),
          barcode: r["Variant Barcode"] || undefined,
          inventory_quantity: r["Variant Inventory Qty"]
            ? Number(r["Variant Inventory Qty"])
            : undefined,
          option1: optionNames[0] ? (r["Option1 Value"] || "") : undefined,
          option2: optionNames[1] ? (r["Option2 Value"] || "") : undefined,
          option3: optionNames[2] ? (r["Option3 Value"] || "") : undefined,
        };

        if (optionNames.length === 0) {
          // pas d'options : Shopify aime "Default Title" si un seul variant
          variant.option1 = "Default Title";
        }
        return variant;
      });

      // Images (uniques, filtrées)
      const imageUrls = Array.from(
        new Set(rows.map((r) => (r["Image Src"] || "").trim()).filter(Boolean))
      );
      const images = imageUrls.map((src) => ({ src }));

      const productPayload = {
        product: {
          title: first.Title || handle,
          body_html: first["Body (HTML)"] || "",
          vendor: first.Vendor || undefined,
          product_type: first.Type || undefined,
          tags: first.Tags || undefined,
          status: toStatus(first.Status),
          options: options.length ? options : undefined,
          variants: variants.length ? variants : [{ option1: "Default Title" }],
          images: images.length ? images : undefined,
          // handle: on peut le laisser à Shopify, mais si tu veux forcer :
          // handle,
        },
      };

      await shopifyRest(shop, accessToken, "POST", "/products.json", productPayload);
      created += 1;
    } catch (e) {
      errors.push({ handle, message: e.message });
    }
  }

  return { ok: true, created, total: byHandle.size, errors };
}
