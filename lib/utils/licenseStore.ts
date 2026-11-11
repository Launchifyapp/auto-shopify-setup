/**
 * License store using Upstash Redis
 * Stores shop licenses: the plan sets the product limit (10 basic / 20 premium) and the
 * niche chosen in the funnel sets which catalog is imported.
 *
 * The external sales site (ClickFunnels) calls /api/license/activate
 * to register a shop's plan. The app reads it at setup time.
 */

import { Redis } from "@upstash/redis";
import { DEFAULT_NICHE, isNiche, Niche } from "@/lib/niches";

// Initialize Redis client from environment variables (may be null if not configured)
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

export type Plan = "basic" | "premium";

/** Products imported per plan: basic gets the 10 core products of its niche, premium all 20. */
export const PRODUCT_LIMIT: Record<Plan, number> = { basic: 10, premium: 20 };

interface LicenseEntry {
  plan: Plan;
  activatedAt: string;
  email?: string;
  niche?: Niche;
}

const LICENSE_PREFIX = "license:";

/**
 * Activate a license for a shop
 * Called by ClickFunnels webhook when a customer purchases
 */
export async function activateLicense(
  shop: string,
  plan: Plan,
  email?: string,
  niche?: Niche
): Promise<void> {
  const key = LICENSE_PREFIX + normalizeShop(shop);
  const entry: LicenseEntry = {
    plan,
    activatedAt: new Date().toISOString(),
    email,
    niche,
  };
  if (!redis) {
    console.log(`[License] Redis not configured, skipping license activation`);
    return;
  }
  await redis.set(key, JSON.stringify(entry));
  console.log(`[License] Activated ${plan} license (${niche ?? "no niche"}) for ${normalizeShop(shop)}`);
}

/**
 * Get the license/plan for a shop
 * Returns "basic" if no license found (default free plan), and DEFAULT_NICHE when the license
 * has no niche (activated before niches existed).
 */
export async function getLicense(shop: string): Promise<{ plan: Plan; email?: string; niche: Niche }> {
  if (!redis) {
    console.log(`[License] Redis not configured, defaulting to premium (no limit)`);
    return { plan: "premium" as Plan, niche: DEFAULT_NICHE };
  }

  const key = LICENSE_PREFIX + normalizeShop(shop);
  const data = await redis.get(key);

  if (!data) {
    console.log(`[License] No license found for ${normalizeShop(shop)}, defaulting to basic`);
    return { plan: "basic", niche: DEFAULT_NICHE };
  }

  const entry: LicenseEntry = typeof data === "string" ? JSON.parse(data) : data as LicenseEntry;
  const niche = isNiche(entry.niche) ? entry.niche : DEFAULT_NICHE;
  console.log(`[License] Found ${entry.plan} license (${niche}) for ${normalizeShop(shop)}`);
  return { plan: entry.plan, email: entry.email, niche };
}

/**
 * Check if a shop has a premium license
 */
export async function isPremium(shop: string): Promise<boolean> {
  const { plan } = await getLicense(shop);
  return plan === "premium";
}

/**
 * Get the product limit based on the shop's plan
 */
export async function getProductLimit(shop: string): Promise<number> {
  const { plan } = await getLicense(shop);
  return PRODUCT_LIMIT[plan];
}

/**
 * Normalize shop domain for consistent key storage
 */
function normalizeShop(shop: string): string {
  let normalized = shop.replace(/^https?:\/\//, "");
  normalized = normalized.replace(/\/$/, "");
  normalized = normalized.split("/")[0];

  if (!normalized.endsWith(".myshopify.com")) {
    const shopName = normalized.split(".")[0];
    normalized = `${shopName}.myshopify.com`;
  }

  return normalized.toLowerCase();
}
