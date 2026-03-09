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
  // Parse CSV (Shopify export uses ;)
  const records = parse(csvText, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    quote: '"',
    trim: true
  });

  // Group by Handle (product group)
  const productsByHandle = {};
  for (const row of records) {
    if (!row.Handle || !row.Handle.trim()) continue;
    productsByHandle[row.Handle] ??= [];
    productsByHandle[row.Handle].push(row);
  }

  const products = [];
  for (const [handle, group] of Object.entries(productsByHandle)) {
    // Always take the first line with title for main product fields
    const main = group.find(row => row.Title && row.Title.trim()) || group[0];

    // 1. Option names (order is strictly kept)
    const optionNames = [];
    for (let i = 1; i <= 3; i++) {
      const name = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (name) optionNames.push(name);
    }

    // 2. productOptions for Shopify API
    const productOptions = optionNames.map((name, idx) => ({
      name,
      values: Array.from(new Set(group.map(row => row[`Option${idx + 1} Value`]).filter(v => !!v && v.trim())))
        .map(v => ({ name: v.trim() }))
    }));

    // PATCH: Proper price extraction (always from the row OR from main, fallback to "0")
    function getPrice(row) {
      const priceClean = (row["Variant Price"] ?? "").replace(",", ".").trim();
      if (priceClean && !isNaN(Number(priceClean))) return priceClean;
      const mainPriceClean = (main["Variant Price"] ?? "").replace(",", ".").trim();
      return mainPriceClean && !isNaN(Number(mainPriceClean)) ? mainPriceClean : "0";
    }
    function getCompareAtPrice(row) {
      const compareClean = (row["Variant Compare At Price"] ?? "").replace(",", ".").trim();
      if (compareClean && !isNaN(Number(compareClean))) return compareClean;
      const mainCompareClean = (main["Variant Compare At Price"] ?? "").replace(",", ".").trim();
      return mainCompareClean && !isNaN(Number(mainCompareClean)) ? mainCompareClean : undefined;
    }

    // 3. PATCH: Unique and complete variants
    const seen = new Set();
    const variants = group
      .map(row => {
        // Build options strictly
        const options = optionNames.map((opt, idx) => row[`Option${idx+1} Value`] ? row[`Option${idx+1} Value`].trim() : "");
        return {
          sku: row["Variant SKU"]?.trim() || "",
          price: getPrice(row),
          compareAtPrice: getCompareAtPrice(row),
          requiresShipping: row["Variant Requires Shipping"] === "True",
          taxable: row["Variant Taxable"] === "True",
          barcode: row["Variant Barcode"]?.trim() || "",
          options // ordered, complete, matches productOptions
        }
      })
      .filter(v => {
        // Only keep variants with all options and valid price
        if (!Array.isArray(v.options) || v.options.length !== optionNames.length || v.options.some(opt => !opt)) return false;
        const key = JSON.stringify(v.options);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // 4. PATCH: Set product price as first variant price (if variants exist, else fallback to main)
    const firstVariantPrice = (variants[0]?.price && !isNaN(Number(variants[0].price))) ? variants[0].price : getPrice(main);

    const payload = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: main.Handle,
      vendor: main.Vendor,
      productType: main["Type"] || main["Product Category"] || "",
      tags: cleanTags(main.Tags ?? main["Product Category"] ?? "").join(","),
      productOptions,
      variants,
      price: firstVariantPrice // optionnel pour debug, API ignore pour les variants bulk mais utile pour tests
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
