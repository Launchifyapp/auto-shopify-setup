import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return NextResponse.json({ error: "Missing shop param" }, { status: 400 });

  const apiKey = process.env.SHOPIFY_API_KEY!;
  const appUrl = process.env.SHOPIFY_APP_URL!;
  const scopes = [
    "write_products",
    "write_pages",
    "write_themes",
    "read_products",
    "write_custom_collections",
    "write_smart_collections",
    "write_content",
    "read_content"
  ].join(",");
  const redirectUri = `${appUrl}/api/auth/callback`;

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=random123`;

  return NextResponse.redirect(installUrl);
}
