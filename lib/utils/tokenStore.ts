/**
 * In-memory token store for Shopify access tokens
 * Stores OAuth access tokens keyed by shop domain
 * 
 * Note: This is a simple in-memory implementation for development/testing.
 * For production, use a proper database or Redis for persistent storage.
 */

interface TokenEntry {
  accessToken: string;
  scope: string;
  timestamp: number;
}

// In-memory store - tokens are lost on server restart
const tokenStore = new Map<string, TokenEntry>();

// Token expiry time for in-memory cache (24 hours in milliseconds)
// Note: This is not related to Shopify's OAuth token expiry. Shopify OAuth tokens
// don't expire for apps, but we clear our cache after 24 hours to limit memory usage
// and ensure fresh authentication flows for long-running app installations.
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Store an access token for a shop
 */
export function storeToken(shop: string, accessToken: string, scope: string): void {
  // Normalize shop domain
  const normalizedShop = normalizeShopDomain(shop);
  
  tokenStore.set(normalizedShop, {
    accessToken,
    scope,
    timestamp: Date.now(),
  });
  
  console.log(`[TokenStore] Stored token for ${normalizedShop}`);
}

/**
 * Retrieve an access token for a shop
 */
export function getToken(shop: string): { accessToken: string; scope: string } | null {
  const normalizedShop = normalizeShopDomain(shop);
  const entry = tokenStore.get(normalizedShop);
  
  if (!entry) {
    console.log(`[TokenStore] No token found for ${normalizedShop}`);
    return null;
  }
  
  // Check if token has expired
  if (Date.now() - entry.timestamp > TOKEN_EXPIRY_MS) {
    console.log(`[TokenStore] Token expired for ${normalizedShop}`);
    tokenStore.delete(normalizedShop);
    return null;
  }
  
  return {
    accessToken: entry.accessToken,
    scope: entry.scope,
  };
}

/**
 * Remove a token for a shop
 */
export function removeToken(shop: string): void {
  const normalizedShop = normalizeShopDomain(shop);
  tokenStore.delete(normalizedShop);
  console.log(`[TokenStore] Removed token for ${normalizedShop}`);
}

/**
 * Check if a token exists for a shop
 */
export function hasToken(shop: string): boolean {
  const normalizedShop = normalizeShopDomain(shop);
  const entry = tokenStore.get(normalizedShop);
  
  if (!entry) {
    return false;
  }
  
  // Check expiry
  if (Date.now() - entry.timestamp > TOKEN_EXPIRY_MS) {
    tokenStore.delete(normalizedShop);
    return false;
  }
  
  return true;
}

/**
 * Normalize shop domain to consistent format
 */
function normalizeShopDomain(shop: string): string {
  // Remove protocol if present
  let normalized = shop.replace(/^https?:\/\//, '');
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '');
  // Ensure .myshopify.com suffix
  if (!normalized.includes('.myshopify.com')) {
    normalized = `${normalized}.myshopify.com`;
  }
  return normalized.toLowerCase();
}
