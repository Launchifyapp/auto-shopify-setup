import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return new NextResponse("Missing shop", { status: 400 });

  // Scopes requis
  const scopes = [
    "read_products","write_products",
    "read_files","write_files",
    "read_online_store_pages","write_online_store_pages",
    "read_online_store_navigation","write_online_store_navigation",
    "read_themes","write_themes"
  ].join(",");

  const redirectUri = `${process.env.SHOPIFY_APP_URL}/api/auth/callback`;
  const url = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return NextResponse.redirect(url);
}
