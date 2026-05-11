import { NextRequest } from "next/server";
import { findRefreshTheme } from "@/lib/findRefreshTheme";
import { getAccessToken } from "@/lib/utils/tokenExchange";
import { authenticateRequest } from "@/lib/utils/verifySessionToken";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const sessionAuth = authenticateRequest(req);
    if (!sessionAuth) {
      return Response.json({ ok: false, error: "Unauthorized. Session token required." }, { status: 401 });
    }

    const { shop, token: sessionToken } = sessionAuth;
    console.log("[find-theme] Authenticated via session token for shop:", shop);

    const { accessToken: token } = await getAccessToken(shop, sessionToken, req);

    const theme = await findRefreshTheme({ shop, token });
    if (!theme) {
      return Response.json({
        ok: false,
        error: "Refresh theme not found. Please install it from the Shopify Theme Store first.",
      });
    }

    console.log("[find-theme] Found Refresh theme:", theme);
    return Response.json({ ok: true, themeId: theme.id });
  } catch (err: any) {
    console.error("[find-theme] Error:", err?.message, err?.stack);
    return Response.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
