// Usage: node shopify-csv-to-graphql-payload.js products.csv
// Output: products.json (array of ProductCreateInput payloads, one per product)
//
// Dependencies: npm install csv-parse

import fs from 'fs';
import { parse } from 'csv-parse/sync';

// --- UTILS ---
function cleanTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map(t => t.trim())
    .filter(t =>
      t && !t.startsWith("<") && !t.startsWith("&") && t !== "null" && t !== "undefined" && t !== "NaN"
    );
}

// --- MAIN CONVERSION FUNCTION ---
function csvToShopifyPayload(csvText: string) {
  // Parse CSV (try to auto-detect delimiter, but Shopify export is usually ";")
  const records = parse(csvText, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    quote: '"',
    trim: true
  });

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

    // --- PATCH: productOptions structure for ProductInput ---
    const productOptions = optionNames.map((name, idx) => ({
      name,
      values: Array.from(new Set(group.map((row) => row[`Option${idx+1} Value`]).filter(v => !!v && v.trim())))
        .map((v) => ({ name: v.trim() }))
    }));

    // --- PATCH: Build strict unique variants array ---
    const rawVariants = group.map(row => ({
      sku: row["Variant SKU"],
      price: row["Variant Price"] || main["Variant Price"] || "0",
      compareAtPrice: row["Variant Compare At Price"] || main["Variant Compare At Price"],
      requiresShipping: row["Variant Requires Shipping"] === "True",
      taxable: row["Variant Taxable"] === "True",
      barcode: row["Variant Barcode"],
      options: optionNames.map((name, idx) => row[`Option${idx+1} Value`] ? row[`Option${idx+1} Value`].trim() : "")
    }));

    // PATCH: Unicité + structure correcte - filter variants
    // - Must have all options
    // - Each combination unique
    // - All option values present (no empty)
    const seen = new Set();
    const variants = rawVariants.filter(v => {
      if (!Array.isArray(v.options)) return false;
      if (v.options.length !== optionNames.length || v.options.some(opt => !opt)) return false;
      const key = JSON.stringify(v.options);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // --- Build payload ---
    const payload = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: main.Handle,
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      productOptions, // PATCHED: for API v2025-10+
      variants        // PATCHED: unique + valid only
    };
    products.push(payload);
  }

  return products;
}

// --- SCRIPT ENTRYPOINT ---
if (require.main === module) {
  const csvFile = process.argv[2];
  if (!csvFile) {
    console.error("Usage: node shopify-csv-to-graphql-payload.js products.csv");
    process.exit(1);
  }
  const csvText = fs.readFileSync(csvFile, "utf8");
  const json = csvToShopifyPayload(csvText);
  fs.writeFileSync("products.json", JSON.stringify(json, null, 2));
  console.log("✅ Created products.json containing Shopify API payloads.");
}

// --- EXPORT ---
export { csvToShopifyPayload };
