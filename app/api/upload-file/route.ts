import { NextRequest } from "next/server";
import FormData from "form-data";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE}/admin/api/2023-07/graphql.json`;

export async function POST(req: NextRequest) {
  const { url, filename, mimeType } = await req.json();

  // Step 1: stagedUploadsCreate
  const stagedRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
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
          }
        }
      `,
      variables: {
        input: [{
          filename,
          mimeType,
          resource: "IMAGE", // "FILE" pour PDF ou ZIP
          httpMethod: "POST",
          fileSize: 1,
        }]
      },
    }),
  });
  const stagedJson = await stagedRes.json();
  const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

  // Step 2: upload to S3
  const uploadForm = new FormData();
  for (const p of target.parameters) {
    uploadForm.append(p.name, p.value);
  }
  const imageRes = await fetch(url);
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
  uploadForm.append("file", imageBuffer, { filename, contentType: mimeType });

  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: uploadForm as any,
    headers: uploadForm.getHeaders(),
  });

  if (!uploadRes.ok) {
    return Response.json({ ok: false, error: "Erreur upload S3", details: await uploadRes.text() }, { status: 500 });
  }

  // Step 3: fileCreate
  const fileCreateRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
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

  return Response.json({ ok: true, fileCreate: fileCreateJson });
}
