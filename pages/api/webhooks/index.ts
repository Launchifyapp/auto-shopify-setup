import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyShopifyWebhook, getRawBody } from '@/lib/utils/verifyWebhook';

// Disable body parsing to get raw body for HMAC verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Main compliance webhook handler for Shopify
 * Handles all mandatory compliance webhooks:
 * - customers/data_request: Customer requests their data
 * - customers/redact: Request to delete customer data
 * - shop/redact: Request to delete shop data (48h after uninstall)
 * 
 * Requirements:
 * - Accept POST requests with Content-Type: application/json
 * - Return 401 Unauthorized for invalid HMAC signature
 * - Return 200 OK to acknowledge receipt
 * 
 * @see https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate Content-Type header
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return res.status(400).json({ error: 'Content-Type must be application/json' });
  }

  // Read raw body as Buffer for HMAC verification
  const rawBody = await getRawBody(req);
  (req as NextApiRequest & { rawBody: Buffer }).rawBody = rawBody;

  // Verify HMAC signature - return 401 Unauthorized if invalid
  if (!verifyShopifyWebhook(req as NextApiRequest & { rawBody: Buffer })) {
    return res.status(401).json({ error: 'Unauthorized - Invalid webhook signature' });
  }

  // Parse headers and payload
  const topic = req.headers['x-shopify-topic'] as string | undefined;
  const shop = req.headers['x-shopify-shop-domain'] as string | undefined;
  
  let payload: Record<string, unknown> = {};
  if (rawBody.length > 0) {
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }

  console.log(`[Webhook] Received ${topic} for shop: ${shop || 'unknown'}`);

  // Extract common properties with safe access
  const customer = payload.customer as { id?: string | number } | undefined;
  const customerId = customer?.id || 'unknown';
  const shopId = payload.shop_id || 'unknown';

  // Handle each compliance topic
  switch (topic) {
    case 'customers/data_request':
      console.log(`[Privacy] customers/data_request - Customer ID: ${customerId}`);
      console.log('[Privacy] Response: No customer data is stored by this application.');
      return res.status(200).json({
        message: 'Data request received - no customer data is stored by this application'
      });

    case 'customers/redact':
      console.log(`[Privacy] customers/redact - Customer ID: ${customerId}`);
      console.log('[Privacy] Response: No customer data to delete - none is stored.');
      return res.status(200).json({
        message: 'Redact request received - no customer data is stored by this application'
      });

    case 'shop/redact':
      console.log(`[Privacy] shop/redact - Shop ID: ${shopId}`);
      console.log('[Privacy] Response: No shop data to delete - none is stored persistently.');
      return res.status(200).json({
        message: 'Shop redact request received - no data is stored persistently by this application'
      });

    default:
      // Return 200 for unhandled topics to acknowledge receipt
      // This prevents Shopify from retrying the webhook
      console.log(`[Webhook] Unhandled topic: ${topic}`);
      return res.status(200).json({ 
        message: 'Webhook received',
        topic: topic || 'unknown'
      });
  }
}
