import { NextRequest } from "next/server";
import { uploadTheme } from "@/lib/uploadTheme";
import { Language } from "@/lib/i18n";
import { getToken } from "@/lib/utils/tokenStore";
import { authenticateRequest } from "@/lib/utils/verifySessionToken";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let shop = searchParams.get("shop");
  const langParam = searchParams.get("lang");
  const lang: Language = langParam === "en" ? "en" : "fr";
  
  // Try to authenticate using session token first (for embedded app)
  const sessionAuth = authenticateRequest(req);
  if (sessionAuth) {
    shop = sessionAuth.shop;
    console.log("[upload-theme] Authenticated via session token for shop:", shop);
  }

  if (!shop) {
    return Response.json({ ok: false, error: "Missing shop parameter!" }, { status: 400 });
  }

  // Get token from store
  const tokenData = getToken(shop);
  if (!tokenData) {
    return Response.json({ ok: false, error: "No access token found. Please reinstall the app." }, { status: 401 });
  }

  const { accessToken: token } = tokenData;

  try {
    const themeId = await uploadTheme({ shop, token, lang });
    return Response.json({ ok: !!themeId, themeId });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
