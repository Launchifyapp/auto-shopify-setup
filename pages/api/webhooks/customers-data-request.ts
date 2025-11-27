import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyShopifyWebhook, getRawBody } from '@/lib/utils/verifyWebhook';

// Disable body parsing to get raw body for HMAC verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Webhook endpoint for customers/data_request
 * Shopify sends this when a customer requests their data under GDPR/CCPA
 * Since this app doesn't store any customer data, we acknowledge the request
 * and respond that no data is held.
 * 
 * @see https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method not allowed');
  }

  // Read raw body as Buffer for HMAC verification
  const rawBody = await getRawBody(req);
  (req as NextApiRequest & { rawBody: Buffer }).rawBody = rawBody;

  if (!verifyShopifyWebhook(req as NextApiRequest & { rawBody: Buffer })) {
    return res.status(401).send('Invalid webhook signature');
  }

  const shop = req.headers['x-shopify-shop-domain'] as string | undefined;
  const payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};

  console.log(`[Privacy] customers/data_request received for shop: ${shop || 'unknown'}`);
  console.log(`[Privacy] Customer ID: ${payload?.customer?.id || 'unknown'}`);
  console.log('[Privacy] Response: No customer data is stored by this application.');

  // Respond with 200 OK - Shopify requires this acknowledgment
  // Since we don't store customer data, there's nothing to export
  res.status(200).json({
    message: 'Data request received - no customer data is stored by this application'
  });
}
