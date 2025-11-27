import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyShopifyWebhook, getRawBody } from '@/lib/utils/verifyWebhook';

// Disable body parsing to get raw body for HMAC verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Webhook endpoint for shop/redact
 * Shopify sends this 48 hours after a store uninstalls the app
 * This is a request to delete all data associated with the shop
 * Since this app doesn't store any shop or customer data persistently,
 * we acknowledge the request and confirm no data needs to be deleted.
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

  console.log(`[Privacy] shop/redact received for shop: ${shop || 'unknown'}`);
  console.log(`[Privacy] Shop ID: ${payload?.shop_id || 'unknown'}`);
  console.log('[Privacy] Response: No shop data to delete - none is stored persistently.');

  // Respond with 200 OK - Shopify requires this acknowledgment
  // Since we don't store shop data persistently, there's nothing to delete
  res.status(200).json({
    message: 'Shop redact request received - no data is stored persistently by this application'
  });
}
