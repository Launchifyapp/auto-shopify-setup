// app/api/products/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminGraphQL } from "@/lib/shopify";
import { parse } from "csv-parse/sync";

const ADMIN_URL = (shop: string, version: string) =>
  `https://${shop}/admin/api/${version}/graphql.json`;

const PRODUCT_CREATE = `#graphql
mutation CreateProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
  productCreate(input: $input, media: $media) {
    product { id handle title }
    userErrors { field message }
  }
}`;

function v(x: any) { return (x ?? "").toString().trim(); }
function b(x: any) { const s = v(x).toLowerCase(); return ["true","1","yes","oui","vrai"].includes(s); }

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // 1) Lire CSV du body, sinon depuis PRODUCTS_CSV_URL
    let csv = await req.text();
    if (!csv || /^\s*$/.test(csv)) {
      const url = process.env.PRODUCTS_CSV_URL;
      if (!url) return NextResponse.json({ ok:false, error:"CSV manquant (body vide et PRODUCTS_CSV_URL non défini)"},{status:400});
      csv = await fetch(url).then(r => r.text());
    }

    const rows: any[] = parse(csv, { columns: true, skip_empty_lines: true });

    // 2) Group by Handle (1 produit = N lignes variantes)
    const byHandle: Record<string, any[]> = {};
    for (const r of rows) {
      const handle = v(r["Handle"]) || v(r["handle"]) || v(r["Slug"]);
      if (!handle) continue;
      (byHandle[handle] ||= []).push(r);
    }

    const shop = process.env.SHOPIFY_SHOP!;
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
    const version = process.env.SHOPIFY_API_VERSION || "2025-10";

    const results: any[] = [];

    for (const [handle, group] of Object.entries(byHandle)) {
      const base = group[0];
      const title = v(base["Title"]) || handle;
      const descriptionHtml = base["Body (HTML)"] ?? base["Body"] ?? "";
      const vendor = v(base["Vendor"]) || undefined;
      const tags = v(base["Tags"]) ? v(base["Tags"]).split(",").map((t:string)=>t.trim()).filter(Boolean) : [];

      // Noms d’options
      const optionNames = [v(base["Option1 Name"]), v(base["Option2 Name"]), v(base["Option3 Name"])].filter(Boolean) as string[];

      // Valeurs uniques par option
      const optionValues: Record<string, Set<string>> = {};
      optionNames.forEach(n => optionValues[n] = new Set());
      for (const r of group) {
        optionNames.forEach((n, i) => {
          const val = v(r[`Option${i+1} Value`]);
          if (val) optionValues[n].add(val);
        });
      }
      const options = optionNames.map(n => ({ name: n, values: Array.from(optionValues[n]) }));

      // Variantes (1 ligne = 1 variante)
      const variants = group.map(r => ({
        sku: v(r["Variant SKU"]) || undefined,
        price: v(r["Variant Price"]) || undefined,
        compareAtPrice: v(r["Variant Compare At Price"]) || undefined,
        requiresShipping: v(r["Variant Requires Shipping"]) ? b(r["Variant Requires Shipping"]) : true,
        taxable: v(r["Variant Taxable"]) ? b(r["Variant Taxable"]) : undefined,
        barcode: v(r["Variant Barcode"]) || undefined,
        options: [v(r["Option1 Value"]) || undefined, v(r["Option2 Value"]) || undefined, v(r["Option3 Value"]) || undefined].filter(Boolean)
      }));

      // Images au niveau produit (Image Src + Variant Image)
      const imageSet = new Set<string>();
      for (const r of group) {
        const a = v(r["Image Src"]) || v(r["Image URL"]) || v(r["image_url"]);
        const bimg = v(r["Variant Image"]);
        [a, bimg].forEach(u => { if (u && /^https?:\/\//.test(u)) imageSet.add(u); });
      }
      const media = Array.from(imageSet).map(u => ({ originalSource: u, mediaContentType: "IMAGE" as const }));

      const input: any = { handle, title, descriptionHtml, vendor, tags, options, variants, status: "ACTIVE" };

      const res = await fetch(ADMIN_URL(shop, version), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: PRODUCT_CREATE, variables: { input, media } }),
      });
      const json = await res.json();
      const errs = json?.data?.productCreate?.userErrors;
      if (errs?.length) throw new Error(JSON.stringify(errs));
      results.push({ handle, title });
    }

    return NextResponse.json({ ok: true, created: results.length, products: results });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
