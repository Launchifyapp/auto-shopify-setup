/**
 * POST /api/license/activate
 *
 * Webhook endpoint called by ClickFunnels when a customer purchases.
 * Registers the shop's plan (basic or premium) in Upstash Redis.
 *
 * Expected JSON body:
 * {
 *   "shop": "my-store.myshopify.com",
 *   "plan": "premium",
 *   "email": "customer@example.com"  (optional)
 * }
 *
 * Secured by a shared secret (LICENCE_WEBHOOK_SECRET) sent in the
 * Authorization header as: Bearer <secret>
 */

import { NextRequest } from "next/server";
import { activateLicense, Plan } from "@/lib/utils/licenseStore";

const VALID_PLANS: Plan[] = ["basic", "premium"];

export async function POST(req: NextRequest) {
  // 1. Verify webhook secret
  const webhookSecret = process.env.LICENSE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[License Webhook] LICENSE_WEBHOOK_SECRET not configured");
    return Response.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2. Parse and validate body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { shop, plan, email } = body;

  if (!shop || typeof shop !== "string") {
    return Response.json(
      { ok: false, error: "Missing or invalid 'shop' parameter" },
      { status: 400 }
    );
  }

  if (!plan || !VALID_PLANS.includes(plan)) {
    return Response.json(
      { ok: false, error: "Invalid 'plan'. Must be 'basic' or 'premium'" },
      { status: 400 }
    );
  }

  // 3. Activate license
  try {
    await activateLicense(shop, plan as Plan, email);
    return Response.json({
      ok: true,
      message: `License activated: ${plan} for ${shop}`,
    });
  } catch (err: any) {
    console.error("[License Webhook] Error:", err);
    return Response.json(
      { ok: false, error: err.message || "Internal error" },
      { status: 500 }
    );
  }
}
