// lib/shopify.js (ajoute/replace ceci)

import fs from "node:fs/promises";
import path from "node:path";

// ---- Utilitaire GraphQL Shopify
async function shopifyGraphQL(shop, accessToken, query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

function guessMime(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

// Vérifie si un fichier (Shopify Files) existe déjà par son filename
async function findExistingFileUrl(shop, accessToken, filename) {
  const query = `
    query($q: String!) {
      files(first: 1, query: $q) {
        edges {
          node {
            __typename
            ... on GenericFile {
              id
              alt
              createdAt
              preview { image { originalSrc: url } }
              originalSource { url }
            }
            ... on MediaImage {
              id
              image { url: originalSrc }
            }
          }
        }
      }
    }`;
  const data = await shopifyGraphQL(shop, accessToken, query, { q: `filename:${filename}` });
  const node = data?.files?.edges?.[0]?.node;
  if (!node) return null;

  // Normaliser l'URL
  if (node.__typename === "MediaImage" && node.image?.url) return node.image.url;
  if (node.preview?.image?.originalSrc) return node.preview.image.originalSrc;
  if (node.originalSource?.url) return node.originalSource.url;
  return null;
}

// Upload d’UN fichier local -> Shopify Files. Retourne l’URL CDN.
async function uploadSingleFileToShopify({ shop, accessToken, filename, absPath }) {
  // 1) Si déjà présent, réutiliser
  const existing = await findExistingFileUrl(shop, accessToken, filename);
  if (existing) return existing;

  const mimeType = guessMime(filename);
  const fileBuffer = await fs.readFile(absPath);

  // 2) stagedUploadsCreate
  const staged = await shopifyGraphQL(
    shop,
    accessToken,
    `
    mutation StagedUploads($inputs: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $inputs) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      inputs: [
        {
          resource: "FILE",
          filename,
          mimeType,
          httpMethod: "POST",
        },
      ],
    }
  );

  const target = staged.stagedUploadsCreate.stagedTargets?.[0];
  if (!target) throw new Error("No staged upload target returned by Shopify");

  // 3) Upload binaire vers S3 (POST multipart)
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);

  const s3Res = await fetch(target.url, { method: "POST", body: form });
  if (!s3Res.ok) {
    const txt = await s3Res.text().catch(() => "");
    throw new Error(`S3 upload failed (${s3Res.status}): ${txt}`);
  }

  // 4) fileCreate pour finaliser
  const created = await shopifyGraphQL(
    shop,
    accessToken,
    `
    mutation FilesCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          __typename
          ... on GenericFile {
            id
            preview { image { originalSrc: url } }
            originalSource { url }
          }
          ... on MediaImage {
            id
            image { url: originalSrc }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      files: [
        {
          originalSource: target.resourceUrl,
          contentType: mimeType,
          filename,
          alt: filename,
        },
      ],
    }
  );

  const node = created.fileCreate.files?.[0];
  if (!node) throw new Error("fileCreate returned no file");
  if (node.__typename === "MediaImage" && node.image?.url) return node.image.url;
  if (node.preview?.image?.originalSrc) return node.preview.image.originalSrc;
  if (node.originalSource?.url) return node.originalSource.url;

  throw new Error("Could not resolve uploaded file URL");
}

/**
 * Uploade toutes les images déclarées dans files.json et retourne une map filename -> url
 * @param {{shop:string, accessToken:string, filesJsonPath:string, imagesDir:string}} opts
 * @returns {Promise<Record<string,string>>}
 */
export async function uploadAllImages({ shop, accessToken, filesJsonPath, imagesDir }) {
  // Lire files.json : ex. [{ "filename": "image1.jpg", "path": "image1.jpg" }, ...]
  const raw = await fs.readFile(filesJsonPath, "utf8");
  const entries = JSON.parse(raw);

  const out = {};
  for (const f of entries) {
    const filename = f.filename || f.name || f.path;
    if (!filename) continue;
    const localPath = path.join(imagesDir, f.path || filename);
    const url = await uploadSingleFileToShopify({ shop, accessToken, filename, absPath: localPath });
    out[filename] = url;
  }
  return out;
}
