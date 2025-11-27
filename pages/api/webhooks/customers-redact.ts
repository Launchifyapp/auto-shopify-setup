import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyShopifyWebhook, getRawBody } from '@/lib/utils/verifyWebhook';

// Disable body parsing to get raw body for HMAC verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Webhook endpoint for customers/redact
 * Shopify sends this when a customer requests deletion of their data under GDPR/CCPA
 * Since this app doesn't store any customer data, we acknowledge the request
 * and confirm no data needs to be deleted.
 * 
 * @see https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate Content-Type header as required by Shopify
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return res.status(400).json({ error: 'Content-Type must be application/json' });
  }

  // Read raw body as Buffer for HMAC verification
  const rawBody = await getRawBody(req);
  (req as NextApiRequest & { rawBody: Buffer }).rawBody = rawBody;

  if (!verifyShopifyWebhook(req as NextApiRequest & { rawBody: Buffer })) {
    return res.status(401).json({ error: 'Unauthorized - Invalid webhook signature' });
  }

  const shop = req.headers['x-shopify-shop-domain'] as string | undefined;
  
  let payload: Record<string, unknown> = {};
  if (rawBody.length > 0) {
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }
  
  const customer = payload.customer as { id?: string | number } | undefined;

  console.log(`[Privacy] customers/redact received for shop: ${shop || 'unknown'}`);
  console.log(`[Privacy] Customer ID: ${customer?.id || 'unknown'}`);
  console.log('[Privacy] Response: No customer data to delete - none is stored.');

  // Respond with 200 OK - Shopify requires this acknowledgment
  // Since we don't store customer data, there's nothing to delete
  res.status(200).json({
    message: 'Redact request received - no customer data is stored by this application'
  });
}
