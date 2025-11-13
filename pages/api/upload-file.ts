export const config = {
  runtime: "nodejs"
};

import type { NextApiRequest, NextApiResponse } from "next";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE}/admin/api/2023-07/graphql.json`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const { url, filename, mimeType } = req.body;

    // 1. Demander le staged upload à Shopify
    const stagedRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? "",
      },
      body: JSON.stringify({
        query: `
          mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                url
                resourceUrl
                parameters {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          input: [{
            filename,
            mimeType,
            resource: "IMAGE",
            httpMethod: "POST",
            fileSize: 1,
          }]
        },
      }),
    });

    const stagedJson = await stagedRes.json();

    // DEBUG: log la réponse en cas de problème
    if (
      !stagedJson?.data?.stagedUploadsCreate?.stagedTargets ||
      stagedJson?.data?.stagedUploadsCreate?.stagedTargets.length === 0
    ) {
      return res.status(500).json({
        ok: false,
        error: "Erreur Shopify stagedUploadsCreate",
        stagedJson // Affiche la réponse complète pour debug
      });
    }

    const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

    // 2. Télécharger le fichier source
    const imageRes = await fetch(url);
    if (!imageRes.ok) {
      return res.status(500).json({ ok: false, error: "Image source introuvable" });
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    // 3. Créer le formulaire natif (multipart) pour S3
    // Il faut utiliser les API standards JS côté Node
    // Next.js supporte `FormData` sur Vercel depuis Node 18+
    const uploadForm = new (globalThis.FormData || require('form-data'))();

    for (const p of target.parameters) {
      uploadForm.append(p.name, p.value);
    }
    // Ajouter le fichier selon l’API native
    uploadForm.append("file", imageBuffer, {
      filename,
      contentType: mimeType
    });

    // 4. Upload du fichier vers S3
    const uploadRes = await fetch(target.url, {
      method: "POST",
      body: uploadForm,
      // headers multipart gérés par FormData natif, ne pas surcharger
    });

    if (!uploadRes.ok) {
      return res.status(500).json({
        ok: false,
        error: "Erreur upload S3",
        details: await uploadRes.text()
      });
    }

    // 5. Création du fichier chez Shopify
    const fileCreateRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? "",
      },
      body: JSON.stringify({
        query: `
          mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                id
                alt
                url
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          files: [{
            originalSource: target.resourceUrl,
            alt: filename,
          }]
        },
      }),
    });

    const fileCreateJson = await fileCreateRes.json();

    res.status(200).json({ ok: true, fileCreate: fileCreateJson });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
}
