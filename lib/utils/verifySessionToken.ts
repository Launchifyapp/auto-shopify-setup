/**
 * Server-side session token verification for Shopify App Bridge
 * Verifies JWT tokens sent by the client for API authentication
 */

import { NextRequest } from 'next/server';
import * as crypto from 'crypto';

interface SessionTokenPayload {
  iss: string; // Issuer (shop domain)
  dest: string; // Destination (shop URL)
  aud: string; // Audience (API key)
  sub: string; // Subject (user ID)
  exp: number; // Expiration time
  nbf: number; // Not before time
  iat: number; // Issued at time
  jti: string; // JWT ID
  sid: string; // Session ID
}

/**
 * Decode a base64url encoded string
 */
function base64UrlDecode(str: string): string {
  // Replace URL-safe characters with standard base64 characters
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Verify JWT signature using HMAC-SHA256 with the API secret
 */
function verifySignature(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiSecret) {
    console.log('[Session Token] API secret not configured');
    return false;
  }

  const [header, payload, signature] = parts;
  const signatureInput = `${header}.${payload}`;

  // Create expected signature using HMAC-SHA256
  const expectedSignature = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureInput)
    .digest('base64url');

  // Compare signatures using timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // Buffer lengths don't match
    return false;
  }
}

/**
 * Extract and decode session token payload with signature verification
 */
export function decodeSessionToken(token: string): SessionTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Verify signature before decoding payload
    if (!verifySignature(token)) {
      console.log('[Session Token] Invalid signature');
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload as SessionTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Verify session token and extract shop information
 * @param token The session token from the Authorization header
 * @returns Object with shop and isValid, or null if invalid
 */
export function verifySessionToken(token: string): { shop: string; isValid: boolean } | null {
  const payload = decodeSessionToken(token);
  
  if (!payload) {
    return null;
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    console.log('[Session Token] Token expired');
    return null;
  }

  // Verify not before
  if (payload.nbf > now) {
    console.log('[Session Token] Token not yet valid');
    return null;
  }

  // Verify audience matches our API key
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (apiKey && payload.aud !== apiKey) {
    console.log('[Session Token] Invalid audience');
    return null;
  }

  // Extract shop from destination URL
  let shop = '';
  try {
    const destUrl = new URL(payload.dest);
    shop = destUrl.hostname;
  } catch {
    // Fallback: try to extract from issuer
    if (payload.iss) {
      try {
        const issUrl = new URL(payload.iss);
        shop = issUrl.hostname;
      } catch {
        // issuer URL is also invalid, shop will be empty
      }
    }
  }

  if (!shop) {
    console.log('[Session Token] Could not extract shop');
    return null;
  }

  return { shop, isValid: true };
}

/**
 * Extract session token from request headers
 */
export function getSessionTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Middleware-style function to verify session token from request
 * Returns shop domain if valid, null otherwise
 */
export function authenticateRequest(req: NextRequest): { shop: string } | null {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    console.log('[Session Token] No token in request');
    return null;
  }

  const result = verifySessionToken(token);
  if (!result || !result.isValid) {
    return null;
  }

  return { shop: result.shop };
}
