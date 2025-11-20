import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_API_SECRET!;

function verifyShopifyWebhook(req: NextApiRequest): boolean {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const hash = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET).update(body, 'utf8').digest('base64');
  return hmacHeader === hash;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Invalid webhook signature');

  const topic = req.headers['x-shopify-topic'];
  const shop = req.headers['x-shopify-shop-domain'];
  const payload = req.body;

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
      res.status(204).send('Not a privacy topic');
      return;
  }

  // Conformité : tu DOIS répondre 200 à Shopify
  res.status(200).send('Webhook processed - no personal data stored');
}
