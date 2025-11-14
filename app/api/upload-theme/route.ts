import { NextRequest } from "next/server";
import { uploadTheme } from "@/lib/uploadTheme";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  const themeZipUrl = searchParams.get("themeZipUrl") || "https://auto-shopify-setup.vercel.app/theme.zip";
  if (!shop || !token) return Response.json({ ok: false, error: "Paramètres shop/token manquants !" }, { status: 400 });
  try {
    const themeId = await uploadTheme({ shop, token, themeZipUrl });
    return Response.json({ ok: !!themeId, themeId });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
