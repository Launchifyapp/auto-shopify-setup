import { NextRequest } from "next/server";
import { publishTheme } from "@/lib/publishTheme";
import { getToken } from "@/lib/utils/tokenStore";
import { authenticateRequest } from "@/lib/utils/verifySessionToken";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let shop = searchParams.get("shop");
  const themeId = Number(searchParams.get("themeId"));

  // Try to authenticate using session token first (for embedded app)
  const sessionAuth = authenticateRequest(req);
  if (sessionAuth) {
    shop = sessionAuth.shop;
    console.log("[publish-theme] Authenticated via session token for shop:", shop);
  }

  if (!shop || !themeId) {
    return Response.json({ ok: false, error: "Missing shop or themeId parameter!" }, { status: 400 });
  }

  // Get token from store
  const tokenData = getToken(shop);
  if (!tokenData) {
    return Response.json({ ok: false, error: "No access token found. Please reinstall the app." }, { status: 401 });
  }

  const { accessToken: token } = tokenData;

  const result = await publishTheme({ shop, token, themeId });
  return Response.json(result);
}
