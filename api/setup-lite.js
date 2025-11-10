// api/setup-lite.js
import { parse } from "csv-parse/sync";
import path from "node:path";
import { readFile } from "node:fs/promises";
import fetch from "node-fetch";

// Petite pause pour éviter les 429
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // 1) Récup cookies posés par /api/callback
    const shop = req.cookies?.shop;
    const accessToken = req.cookies?.accessToken;

    if (!shop || !accessToken) {
      return res.status(401).json({
        ok: false,
        error: "Missing `shop` or `accessToken` cookie. Repasser par /api/install."
      });
    }

    // 2) Lire le fichier CSV inclus dans le build Vercel : /public/seed/products.csv
    const csvPath = path.join(process.cwd(), "public", "seed", "products.csv");
    const csvBuffer = await readFile(csvPath);
    const records = parse(csvBuffer, {
      columns: true,          // première ligne = headers
      skip_empty_lines: true,
      trim: true
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ ok: false, error: "CSV is empty or invalid" });
    }

    // 3) Import REST vers Shopify
    const apiBase = `https://${shop}/admin/api/2024-10`;

    let created = 0;
    const errors = [];

    for (const row of records) {
      // Adapte ici le mapping -> colonnes attendues dans ton CSV
      // Exemples de colonnes courantes : Title, Body (HTML), Vendor, Product Type, Tags, Status, Price, Image Src, etc.
      const productPayload = {
        product: {
          title: row.Title || row.title || "Sans titre",
          body_html: row["Body (HTML)"] || row.Body || row.Description || "",
          vendor: row.Vendor || row.brand || "",
          product_type: row["Product Type"] || row.type || "",
          tags: row.Tags || row.tags || "",
          status: (row.Status || "active").toLowerCase(), // "active" | "draft" | "archived"
        }
      };

      try {
        const r = await fetch(`${apiBase}/products.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken
          },
          body: JSON.stringify(productPayload)
        });

        if (!r.ok) {
          const txt = await r.text();
          errors.push({ row: row.Title || row.title, status: r.status, body: txt });
        } else {
          created += 1;
        }
      } catch (e) {
        errors.push({ row: row.Title || row.title, error: String(e) });
      }

      // évite de cogner les limites
      await sleep(200);
    }

    return res.status(200).json({
      ok: true,
      imported: created,
      failed: errors.length,
      errors
    });
  } catch (err) {
    console.error("SETUP-LITE ERROR", err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
