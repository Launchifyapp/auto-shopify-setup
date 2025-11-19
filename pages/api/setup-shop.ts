import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

// --- UTILS (copié du loader + script conversion) ---
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v &&
    v !== "nan" &&
    v !== "null" &&
    v !== "undefined" &&
    /^https?:\/\/\S+$/i.test(v);
}

function cleanTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map(t => t.trim())
    .filter(t =>
      t && !t.startsWith("<") && !t.startsWith("&") && t !== "null" && t !== "undefined" && t !== "NaN"
    );
}

function parseCsvShopify(csvText: string): any[] {
  return parse(csvText, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    quote: '"',
    trim: true
  });
}

// --- CSV => Shopify ProductCreateInput Conversion ---
function csvToShopifyPayload(csvText: string) {
  // Parse CSV
  const records = parseCsvShopify(csvText);

  // Group by Handle (product group)
  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!row.Handle || !row.Handle.trim()) continue;
    productsByHandle[row.Handle] ??= [];
    productsByHandle[row.Handle].push(row);
  }

  // For each product: build ProductCreateInput
  const products: any[] = [];
  for (const [handle, group] of Object.entries(productsByHandle)) {
    const main = group.find(row => row.Title && row.Title.trim()) || group[0];

    // --- Option names from first line (always keep original order) ---
    const optionNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }

    // --- Build variants array ---
    const variants = group
      .filter(row => optionNames.some((name, idx) => row[`Option${idx + 1} Value`]))
      .map(row => ({
        sku: row["Variant SKU"],
        price: row["Variant Price"] || main["Variant Price"] || "0",
        compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"],
        requiresShipping: row["Variant Requires Shipping"] === "True",
        taxable: row["Variant Taxable"] === "True",
        barcode: row["Variant Barcode"],
        selectedOptions: optionNames.map((name, idx) => ({
          name,
          value: row[`Option${idx + 1} Value`] || ""
        })).filter(opt => opt.value)
      }));

    // --- Build payload ---
    const payload = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: main.Handle,
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      options: optionNames,   // ["Couleur", ...]
      variants                // array of variants
      // You can map images if using API to attach after creation
    };
    products.push(payload);
  }

  return products;
}

// --- API ROUTE HANDLER ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { shop, token } = req.query;
    if (!shop || !token) return res.status(400).json({ ok: false, error: "Missing shop or token" });

    // 1. Récupère le CSV ("products.csv" dispo localement OU à distance)
    // - Si tu veux lire depuis le local: const csvText = fs.readFileSync("tools/shopify-csv-to-api/products.csv", "utf8");
    // - Ici version distant :
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();

    // 2. Convertit le CSV natif en array de payload ProductCreateInput API Shopify
    const products = csvToShopifyPayload(csvText);
    console.log("Payloads générés (shopify API):", products);

    // 3. Pour chaque produit, push via l'API Shopify productCreate
    let count = 0, errors: any[] = [];
    for (const productPayload of products) {
      try {
        const gqlRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token as string },
          body: JSON.stringify({
            query: `
              mutation productCreate($product: ProductCreateInput!) {
                productCreate(product: $product) {
                  product {
                    id title handle
                  }
                  userErrors { field message }
                }
              }
            `,
            variables: { product: productPayload }
          }),
        });
        const json = await gqlRes.json();
        if (
          json?.data?.productCreate?.product?.id 
          && !(json?.data?.productCreate?.userErrors && json?.data?.productCreate?.userErrors.length)
        ){
          count++;
        } else {
          errors.push({
            handle: productPayload.handle,
            details: json?.data?.productCreate?.userErrors || json.errors || "Unknown error",
            payload: productPayload
          });
        }
      } catch (err) {
        errors.push({ handle: productPayload.handle, details: err });
      }
      // Shopify rate limit ! 
      await new Promise(res => setTimeout(res, 250));
    }

    // Optionnel: retourner les payloads ou juste le succès
    return res.status(200).json({
      ok: errors.length === 0,
      created: count,
      errors: errors,
      payloads: products
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || err });
  }
}
