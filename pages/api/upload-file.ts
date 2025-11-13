import type { NextApiRequest, NextApiResponse } from "next";
import { FormData } from "formdata-node";
import { File } from "fetch-blob";

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

    // Step 1: stagedUploadsCreate
    const stagedRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? "",
      } as HeadersInit,
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
    uploadForm.append("file", new File([imageBuffer], filename, { type: mimeType }));

    const uploadRes = await fetch(target.url, {
      method: "POST",
      body: uploadForm as unknown as BodyInit,
      // formdata-node gère headers multipart
    });

    if (!uploadRes.ok) {
      res.status(500).json({
        ok: false,
        error: "Erreur upload S3",
        details: await uploadRes.text(),
      });
      return;
    }

    // Step 3: fileCreate
    const fileCreateRes = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN ?? "",
      } as HeadersInit,
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
