import { NextRequest } from "next/server";
import { setupPhaseInit, setupPhaseProducts, setupPhaseFinalize } from "@/lib/setupShop";
import { Session } from "@shopify/shopify-api";
import { Language } from "@/lib/i18n";
import { DEFAULT_SESSION_SCOPE } from "@/lib/scopes";
import { getAccessToken } from "@/lib/utils/tokenExchange";
import { authenticateRequest } from "@/lib/utils/verifySessionToken";

// 10 s is the Hobby limit; keep this for when user upgrades to Pro
export const maxDuration = 60;

function getSession(shop: string, accessToken: string, scope: string): Session {
  if (!shop || typeof shop !== "string") throw new Error("Missing or invalid shop parameter!");
  if (!accessToken || typeof accessToken !== "string") throw new Error("Missing or invalid token/accessToken parameter!");
  const sessionScope = scope || DEFAULT_SESSION_SCOPE;
  return new Session({
    id: `${shop}_${Date.now()}`,
    shop,
    state: "setup-shop",
    isOnline: true,
    accessToken,
    scope: sessionScope,
    expires: undefined,
    onlineAccessInfo: undefined,
  });
}

/**
 * Multi-phase setup-shop endpoint.
 *
 * Phase 1 — init:      GET /api/setup-shop?phase=init&lang=fr
 * Phase 2 — products:  GET /api/setup-shop?phase=products&setupId=xxx&batch=0
 * Phase 3 — finalize:  GET /api/setup-shop?phase=finalize&setupId=xxx
 *
 * Each phase completes within ~8 s (safe for Vercel Hobby 10 s limit).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const phase = searchParams.get("phase") || "init";
    const langParam = searchParams.get("lang");
    const lang: Language = langParam === "en" ? "en" : "fr";

    // Env var check
    if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
      return Response.json({ ok: false, error: "Server misconfiguration: missing Shopify API credentials" }, { status: 500 });
    }

    // Authenticate
    const sessionAuth = authenticateRequest(req);
    if (!sessionAuth) {
      return Response.json({ ok: false, error: "Unauthorized. Session token required." }, { status: 401 });
    }

    const { shop, token: sessionToken } = sessionAuth;
    const { accessToken, scope } = await getAccessToken(shop, sessionToken, req);
    const session = getSession(shop, accessToken, scope);

    // ─── Phase routing ───
    if (phase === "init") {
      console.log(`[setup-shop] Phase INIT for ${shop}`);
      const result = await setupPhaseInit({ session, lang });
      return Response.json({ ok: true, ...result });
    }

    if (phase === "products") {
      const setupId = searchParams.get("setupId");
      const batch = parseInt(searchParams.get("batch") || "0", 10);
      if (!setupId) return Response.json({ ok: false, error: "Missing setupId" }, { status: 400 });
      console.log(`[setup-shop] Phase PRODUCTS for ${shop}, batch ${batch}`);
      const result = await setupPhaseProducts({ session, setupId, batch });
      return Response.json(result);
    }

    if (phase === "finalize") {
      const setupId = searchParams.get("setupId");
      if (!setupId) return Response.json({ ok: false, error: "Missing setupId" }, { status: 400 });
      console.log(`[setup-shop] Phase FINALIZE for ${shop}`);
      const result = await setupPhaseFinalize({ session, setupId });
      return Response.json(result);
    }

    return Response.json({ ok: false, error: `Unknown phase: ${phase}` }, { status: 400 });
  } catch (err: any) {
    console.error("[setup-shop] Global error:", err?.message, err?.stack);
    return Response.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
