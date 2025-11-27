import type { NextApiRequest } from 'next';
import crypto from 'crypto';

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_API_SECRET || '';

/**
 * Verifies Shopify webhook signature using HMAC-SHA256
 * Uses timing-safe comparison as required by Shopify
 * Note: Requires API routes to disable body parsing to get raw body
 * Add this to your webhook endpoints:
 * export const config = { api: { bodyParser: false } };
 * 
 * @see https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-5-verify-the-webhook
 */
export function verifyShopifyWebhook(req: NextApiRequest & { rawBody?: Buffer }): boolean {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
  if (!hmacHeader || !SHOPIFY_WEBHOOK_SECRET) {
    return false;
  }

  // Use rawBody Buffer if available (when bodyParser is disabled)
  const body = req.rawBody;
  if (!body) {
    return false;
  }

  // Compute HMAC using the raw body buffer
  const computedHmac = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body)
    .digest('base64');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const hmacBuffer = Buffer.from(hmacHeader, 'base64');
    const computedBuffer = Buffer.from(computedHmac, 'base64');

    // Buffers must be same length for timingSafeEqual
    if (hmacBuffer.length !== computedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(hmacBuffer, computedBuffer);
  } catch {
    return false;
  }
}

/**
 * Reads raw body from request stream as a Buffer
 * Use this when body parsing is disabled
 * Preserves exact bytes for HMAC verification
 */
export async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}
