import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { adminGraphQL } from "@/lib/shopify";

const val = (v: any) => (v ?? "").toString().trim();
const bool = (v: any) => ["true","1","oui","yes","vrai"].includes(val(v).toLowerCase());

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const csv = await req.text();
    if (!csv || /^\s*$/.test(csv)) {
      return NextResponse.json({ ok:false, error:"Body CSV vide" }, { status: 400 });
    }
    const rows: any[] = parse(csv, { columns: true, skip_empty_lines: true });

    const byHandle: Record<string, any[]> = {};
    for (const r of rows) {
      const handle = val(r["Handle"] ?? r["handle"] ?? r["Slug"]);
      if (!handle) continue;
      (byHandle[handle] ||= []).push(r);
    }

    const CREATE = `#graphql
      mutation($input:ProductInput!,$media:[CreateMediaInput!]){
        productCreate(input:$input, media:$media){
          product{ id handle }
          userErrors{ field message }
        }
      }`;

    const results:any[] = [];
    for (const [handle, group] of Object.entries(byHandle)) {
      const base = group[0];
      const title = val(base["Title"]) || handle;
      const descriptionHtml = base["Body (HTML)"] ?? base["Body"] ?? "";
      const vendor = val(base["Vendor"]) || undefined;
      const tags = val(base["Tags"]) ? val(base["Tags"]).split(",").map((t:string)=>t.trim()).filter(Boolean) : [];

      const optionNames = [val(base["Option1 Name"]), val(base["Option2 Name"]), val(base["Option3 Name"])].filter(Boolean) as string[];
      const optionValues: Record<string, Set<string>> = {};
      optionNames.forEach(n => (optionValues[n] = new Set()));
      for (const r of group) {
        optionNames.forEach((n, idx) => {
          const vv = val(r[`Option${idx+1} Value`]);
          if (vv) optionValues[n].add(vv);
        });
      }
      const options = optionNames.map(n => ({ name: n, values: Array.from(optionValues[n]) }));

      const variants = group.map(r => ({
        sku: val(r["Variant SKU"]) || undefined,
        price: val(r["Variant Price"]) || undefined,
        compareAtPrice: val(r["Variant Compare At Price"]) || undefined,
        requiresShipping: val(r["Variant Requires Shipping"]) ? bool(r["Variant Requires Shipping"]) : true,
        taxable: val(r["Variant Taxable"]) ? bool(r["Variant Taxable"]) : undefined,
        barcode: val(r["Variant Barcode"]) || undefined,
        options: [val(r["Option1 Value"]) || undefined, val(r["Option2 Value"]) || undefined, val(r["Option3 Value"]) || undefined].filter(v => v !== undefined)
      }));

      const imageSet = new Set<string>();
      for (const r of group) {
        const a = val(r["Image Src"]) || val(r["Image URL"]) || val(r["image_url"]) || "";
        const b = val(r["Variant Image"]) || "";
        [a,b].forEach(u => { if (u && /^https?:\/\//.test(u)) imageSet.add(u); });
      }
      const media = Array.from(imageSet).map(u => ({ originalSource: u, mediaContentType: "IMAGE" as const }));

      const data = await adminGraphQL<{ productCreate:any }>({ query: CREATE, variables: { input: { handle, title, descriptionHtml, vendor, tags, options, variants, status: "ACTIVE" }, media } });
      if (data.productCreate.userErrors?.length) throw new Error(JSON.stringify(data.productCreate.userErrors));
      results.push({ handle });
    }

    return NextResponse.json({ ok:true, created: results.length, products: results });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message }, { status: 500 });
  }
}
