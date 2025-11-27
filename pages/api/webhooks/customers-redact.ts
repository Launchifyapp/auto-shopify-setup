import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyShopifyWebhook } from '@/lib/utils/verifyWebhook';

/**
 * Webhook endpoint for customers/redact
 * Shopify sends this when a customer requests deletion of their data under GDPR/CCPA
 * Since this app doesn't store any customer data, we acknowledge the request
 * and confirm no data needs to be deleted.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method not allowed');
  }

  if (!verifyShopifyWebhook(req)) {
    return res.status(401).send('Invalid webhook signature');
  }

  const shop = req.headers['x-shopify-shop-domain'];
  const payload = req.body;

  console.log(`[Privacy] customers/redact received for shop: ${shop}`);
  console.log(`[Privacy] Customer ID: ${payload?.customer?.id || 'unknown'}`);
  console.log('[Privacy] Response: No customer data to delete - none is stored.');

  // Respond with 200 OK - Shopify requires this acknowledgment
  // Since we don't store customer data, there's nothing to delete
  res.status(200).json({
    message: 'Redact request received - no customer data is stored by this application'
  });
}
