/**
 * License store using Upstash Redis
 * Stores shop licenses to determine product limits (20 basic / 40 premium)
 *
 * The external sales site (ClickFunnels) calls /api/license/activate
 * to register a shop's plan. The app reads it at setup time.
 */

import { Redis } from "@upstash/redis";

// Initialize Redis client from environment variables (may be null if not configured)
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

export type Plan = "basic" | "premium";

interface LicenseEntry {
  plan: Plan;
  activatedAt: string;
  email?: string;
}

const LICENSE_PREFIX = "license:";

/**
 * Activate a license for a shop
 * Called by ClickFunnels webhook when a customer purchases
 */
export async function activateLicense(
  shop: string,
  plan: Plan,
  email?: string
): Promise<void> {
  const key = LICENSE_PREFIX + normalizeShop(shop);
  const entry: LicenseEntry = {
    plan,
    activatedAt: new Date().toISOString(),
    email,
  };
  if (!redis) {
    console.log(`[License] Redis not configured, skipping license activation`);
    return;
  }
  await redis.set(key, JSON.stringify(entry));
  console.log(`[License] Activated ${plan} license for ${normalizeShop(shop)}`);
}

/**
 * Get the license/plan for a shop
 * Returns "basic" if no license found (default free plan)
 */
export async function getLicense(shop: string): Promise<{ plan: Plan; email?: string }> {
  if (!redis) {
    console.log(`[License] Redis not configured, defaulting to basic`);
    return { plan: "basic" as Plan };
  }

  const key = LICENSE_PREFIX + normalizeShop(shop);
  const data = await redis.get(key);

  if (!data) {
    console.log(`[License] No license found for ${normalizeShop(shop)}, defaulting to basic`);
    return { plan: "basic" };
  }

  const entry: LicenseEntry = typeof data === "string" ? JSON.parse(data) : data as LicenseEntry;
  console.log(`[License] Found ${entry.plan} license for ${normalizeShop(shop)}`);
  return { plan: entry.plan, email: entry.email };
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
  return plan === "premium" ? 40 : 20;
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
