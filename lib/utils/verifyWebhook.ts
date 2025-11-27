import type { NextApiRequest } from 'next';
import crypto from 'crypto';

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_API_SECRET || '';

/**
 * Verifies Shopify webhook signature using HMAC-SHA256
 * Note: Requires API routes to disable body parsing to get raw body
 * Add this to your webhook endpoints:
 * export const config = { api: { bodyParser: false } };
 */
export function verifyShopifyWebhook(req: NextApiRequest & { rawBody?: string }): boolean {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
  if (!hmacHeader || !SHOPIFY_WEBHOOK_SECRET) {
    return false;
  }
  // Use rawBody if available (when bodyParser is disabled), otherwise fall back to JSON.stringify
  const body = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  const hash = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET).update(body, 'utf8').digest('base64');
  return hmacHeader === hash;
}

/**
 * Reads raw body from request stream
 * Use this when body parsing is disabled
 */
export async function getRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}
