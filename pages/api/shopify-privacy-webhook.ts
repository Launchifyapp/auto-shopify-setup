import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyShopifyWebhook, getRawBody } from '@/lib/utils/verifyWebhook';

// Disable body parsing to get raw body for HMAC verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Legacy webhook endpoint for Shopify privacy webhooks
 * This endpoint handles all privacy topics in a single handler
 * Consider using the individual endpoints in /api/webhooks/ instead
 * 
 * @see https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  const topic = req.headers['x-shopify-topic'];
  const shop = req.headers['x-shopify-shop-domain'];
  const payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};

  console.log(`[PRIVACY] Shopify webhook reçu: ${topic} for shop: ${shop}`);
  // Ici, on log la demande pour traçabilité, mais on n'a aucune donnée à exporter/supprimer

  switch (topic) {
    case 'customers/data_request':
      // Aucun stockage = rien à exporter. On log et répond « OK aucun data ».
      console.log('[Privacy] customers/data_request: aucune donnée à exporter pour ce client.');
      break;

    case 'customers/redact':
      // Aucun stockage = rien à supprimer. On log la suppression fictive.
      console.log('[Privacy] customers/redact: aucune donnée à supprimer pour ce client.');
      break;

    case 'shop/redact':
      // Aucun stockage = rien à supprimer. On log la suppression fictive.
      console.log('[Privacy] shop/redact: aucune donnée à supprimer pour cette boutique.');
      break;

    default:
      return res.status(200).json({ message: 'Webhook received but topic not handled' });
  }

  // Conformité : tu DOIS répondre 200 à Shopify
  res.status(200).json({ message: 'Webhook processed - no personal data stored' });
}
