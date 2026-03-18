import { NextRequest } from "next/server";
import { publishTheme } from "@/lib/publishTheme";
import { getAccessToken } from "@/lib/utils/tokenExchange";
import { authenticateRequest } from "@/lib/utils/verifySessionToken";

// Allow up to 120 s on Vercel Pro (default is 10 s on Hobby)
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const themeId = Number(searchParams.get("themeId"));

  // Authenticate using session token (required for embedded apps)
  const sessionAuth = authenticateRequest(req);
  if (!sessionAuth) {
    return Response.json({ ok: false, error: "Unauthorized. Session token required." }, { status: 401 });
  }

  const { shop, token: sessionToken } = sessionAuth;
  console.log("[publish-theme] Authenticated via session token for shop:", shop);

  if (!themeId) {
    return Response.json({ ok: false, error: "Missing themeId parameter!" }, { status: 400 });
  }

  try {
    const { accessToken: token } = await getAccessToken(shop, sessionToken, req);

    const result = await publishTheme({ shop, token, themeId });
    return Response.json(result);
  } catch (err) {
    console.error("[publish-theme] Error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
