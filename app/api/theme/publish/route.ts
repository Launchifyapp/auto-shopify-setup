// app/api/theme/publish/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminREST } from "@/lib/shopify";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const zipUrl = body.zipUrl || process.env.THEME_ZIP_URL;
    if (!zipUrl) return NextResponse.json({ ok:false, error:"zipUrl manquant" }, { status:400 });

    const shop = process.env.SHOPIFY_SHOP!;
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
    const version = process.env.SHOPIFY_API_VERSION || "2025-10";

    const res = await fetch(`https://${shop}/admin/api/${version}/themes.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ theme: { name: "Client Theme", src: zipUrl, role: "main" } }),
    });

    if (!res.ok) throw new Error(`Theme upload failed: ${res.status}`);
    const json = await res.json();
    return NextResponse.json({ ok:true, theme: json.theme || json });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
