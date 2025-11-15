import { NextRequest } from "next/server";
import { publishTheme } from "@/lib/publishTheme";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  const themeId = Number(searchParams.get("themeId"));
  if (!shop || !token || !themeId) return Response.json({ ok: false, error: "Paramètres manquants !" }, { status: 400 });
  const result = await publishTheme({ shop, token, themeId });
  return Response.json(result);
}
