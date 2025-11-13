import { NextRequest } from "next/server";
import FormData from "form-data";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE}/admin/api/2023-07/graphql.json`;

export async function POST(req: NextRequest) {
  // Récupère l’URL publique à uploader (ou hard-code pour test)
  const { url, filename, mimeType } = await req.json();

  // Step 1. stagedUploadsCreate mutation
  const stagedUploadsMutation = `
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
      }
    }
  `;
  const stagedUploadVariables = {
    input: [
      {
        filename,
        mimeType,
        resource: "FILE", // Ou "IMAGE" selon le type
        httpMethod: "POST",
        fileSize: 1, // Shopify ignore si "source_url" => 1 = dummy
        url, // Shopify va aller chercher le fichier à cette URL si utilisé
      },
    ],
  };

  // Envoie mutation GraphQL
  const stagedRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
    },
    body: JSON.stringify({
      query: stagedUploadsMutation,
      variables: stagedUploadVariables,
    }),
  });
  const stagedJson = await stagedRes.json();
  const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

  // Step 2. Upload image à S3 via POST multipart/form-data
  // Shopify donne tous les paramètres dans target.parameters
  const uploadForm = new FormData();
  for (const p of target.parameters) {
    uploadForm.append(p.name, p.value);
  }

  // On récupère et télécharge l’image localement
  const imageRes = await fetch(url);
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
  uploadForm.append("file", imageBuffer, { filename, contentType: mimeType });

  // Envoie vers S3
  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: uploadForm as any, // Node.js FormData
    headers: uploadForm.getHeaders(),
  });

  if (!uploadRes.ok) {
    return Response.json({ ok: false, error: "Erreur upload S3", details: await uploadRes.text() }, { status: 500 });
  }

  // Step 3. fileCreate mutation (enregistre le fichier dans Shopify)
  const fileCreateMutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          alt
          createdAt
          url
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const fileCreateVars = {
    files: [
      {
        originalSource: target.resourceUrl, // URL S3 donné par Shopify
        alt: filename,
      },
    ],
  };

  const createRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
    },
    body: JSON.stringify({ query: fileCreateMutation, variables: fileCreateVars }),
  });
  const createJson = await createRes.json();

  // Retourne la réponse
  return Response.json({
    ok: true,
    stagedUpload: target,
    s3UploadStatus: uploadRes.status,
    fileCreate: createJson,
  });
}
