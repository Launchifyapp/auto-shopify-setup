import { NextRequest } from "next/server";
import { uploadTheme } from "@/lib/uploadTheme";
import { Language } from "@/lib/i18n";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  const langParam = searchParams.get("lang");
  const lang: Language = langParam === "en" ? "en" : "fr";
  
  if (!shop || !token) return Response.json({ ok: false, error: "Missing shop/token parameters!" }, { status: 400 });
  try {
    const themeId = await uploadTheme({ shop, token, lang });
    return Response.json({ ok: !!themeId, themeId });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
