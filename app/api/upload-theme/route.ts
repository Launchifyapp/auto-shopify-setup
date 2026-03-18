import { NextRequest } from "next/server";
import { uploadTheme } from "@/lib/uploadTheme";
import { Language } from "@/lib/i18n";
import { getAccessToken } from "@/lib/utils/tokenExchange";
import { authenticateRequest } from "@/lib/utils/verifySessionToken";

// Allow up to 120 s on Vercel Pro (default is 10 s on Hobby)
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const langParam = searchParams.get("lang");
  const lang: Language = langParam === "en" ? "en" : "fr";

  // Authenticate using session token (required for embedded apps)
  const sessionAuth = authenticateRequest(req);
  if (!sessionAuth) {
    return Response.json({ ok: false, error: "Unauthorized. Session token required." }, { status: 401 });
  }

  const { shop, token: sessionToken } = sessionAuth;
  console.log("[upload-theme] Authenticated via session token for shop:", shop);

  try {
    const { accessToken: token } = await getAccessToken(shop, sessionToken, req);

    const themeId = await uploadTheme({ shop, token, lang });
    return Response.json({ ok: !!themeId, themeId });
  } catch (err) {
    console.error("[upload-theme] Error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
