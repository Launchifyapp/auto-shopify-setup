import { NextRequest, NextResponse } from "next/server";
import { adminREST } from "@/lib/shopify";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const zipUrl = body.zipUrl || process.env.THEME_ZIP_URL;
    const shop = body.shop || process.env.SHOPIFY_SHOP;
    const token = body.token || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    if (!zipUrl || !shop || !token) {
      return NextResponse.json({ ok:false, error:"zipUrl, shop, token requis (ou configure les variables)" }, { status: 400 });
    }
    const created = await adminREST({
      shop, token,
      path: "/themes.json",
      method: "POST",
      json: { theme: { name: "Client Theme", src: zipUrl, role: "main" } }
    });
    return NextResponse.json({ ok:true, theme: created?.theme || created });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message }, { status: 500 });
  }
}
