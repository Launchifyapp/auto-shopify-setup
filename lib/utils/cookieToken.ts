/**
 * Encrypted cookie-based token storage.
 *
 * Persists the Shopify access token in an HttpOnly cookie so it survives
 * across Vercel serverless cold starts (where the in-memory tokenStore is
 * empty) without relying on Token Exchange.
 *
 * Encryption: AES-256-GCM with SESSION_SECRET (first 32 bytes).
 */

import * as crypto from "crypto";
import { NextRequest } from "next/server";

const COOKIE_NAME = "shopify_at";

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET || "";
  // Derive a 32-byte key from the secret
  return crypto.createHash("sha256").update(secret).digest();
}

/** Encrypt `shop|accessToken|scope` → base64 string */
export function encryptToken(shop: string, accessToken: string, scope: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify({ s: shop, t: accessToken, c: scope });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

/** Decrypt base64 string → { shop, accessToken, scope } | null */
export function decryptToken(value: string): { shop: string; accessToken: string; scope: string } | null {
  try {
    const key = getKey();
    const buf = Buffer.from(value, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const data = JSON.parse(decrypted);
    return { shop: data.s, accessToken: data.t, scope: data.c };
  } catch {
    return null;
  }
}

/** Build Set-Cookie header value */
export function buildTokenCookie(shop: string, accessToken: string, scope: string): string {
  const value = encryptToken(shop, accessToken, scope);
  // SameSite=None + Secure required for cross-site iframe (Shopify admin embeds our app)
  // Partitioned for Chrome CHIPS support
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=86400`;
}

/** Read and decrypt the token cookie from a request */
export function readTokenCookie(req: NextRequest): { shop: string; accessToken: string; scope: string } | null {
  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  return decryptToken(cookie.value);
}
