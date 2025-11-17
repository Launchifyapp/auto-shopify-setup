import { parse } from "csv-parse/sync";
import { Buffer } from "buffer";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile } from "./batchUploadUniversal";
import { fetch } from "undici";

/**
 * Polls Shopify GraphQL API for a MediaImage preview URL until it's available or times out.
 * @param shop - shop domain
 * @param token - Shopify Admin token
 * @param mediaImageId - MediaImage gid (e.g. "gid://shopify/MediaImage/1234567890")
 * @param intervalMs - poll interval (default 3s)
 * @param maxTries - max polls (default 20)
 * @returns {Promise<string|null>} - image CDN url or null
 */
export async function pollShopifyImageCDNUrl(
  shop: string,
  token: string,
  mediaImageId: string,
  intervalMs = 3000,
  maxTries = 20
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        query: `
          query GetMediaImageCDN($id: ID!) {
            file(id: $id) {
              ... on MediaImage {
                id
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        `,
        variables: { id: mediaImageId }
      })
    });
    const bodyText = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`Shopify polling failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
    }
    const url = json?.data?.file?.preview?.image?.url ?? null;
    console.log(`[Shopify] Poll try=${attempt}/${maxTries} for MediaImage id=${mediaImageId}: url=${url ?? "null"}`);
    if (url) {
      console.log(`[Shopify] CDN image url is READY: ${url}`);
      return url;
    }
    if (attempt < maxTries) {
      await new Promise(res => setTimeout(res, intervalMs));
    }
  }
  console.warn(`[Shopify] Polling finished: CDN image url is STILL null for MediaImage id=${mediaImageId} after ${maxTries} tries`);
  return null;
}

/** Détecter le séparateur ; ou , pour CSV Shopify FR/EN */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/**
 * Fallback: recherche une image dans Files Shopify par filename, retourne l'URL CDN si trouvée.
 */
async function searchShopifyFileByFilename(shop: string, token: string, filename: string): Promise<string | null> {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        query getFiles($filename: String!) {
          files(first: 10, query: $filename) {
            edges {
              node {
                ... on MediaImage {
                  preview { image { url } }
                }
              }
            }
          }
        }
      `,
      variables: { filename }
    })
  });
  const body = await res.json() as any;
  const node = body?.data?.files?.edges?.[0]?.node;
  const url = node?.preview?.image?.url ?? null;
  if (url) {
    console.log(`[Shopify] Fallback CDN url from Files by filename (${filename}): ${url}`);
    return url;
  }
  return null;
}

/**
 * Upload universel : directe par URL (GraphQL fileCreate) si le domaine est accepté, sinon staged upload Shopify (stagedUploadsCreate + S3 + fileCreate).
 * Fallback filename: tente de retrouver l'image dans Files si Shopify tarde à générer la CDN.
 */
async function uploadImageToShopifyUniversal(shop: string, token: string, imageUrl: string, filename: string): Promise<string | null> {
  if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";
  // 1. Upload direct par URL via GraphQL
  const fileCreateRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              fileStatus
              preview {
                image {
                  url
                }
              }
            }
            userErrors { field message }
          }
        }
      `,
      variables: { files: [{ originalSource: imageUrl, alt: filename }] }
    })
  });
  const fileCreateBodyText = await fileCreateRes.text();
  let fileCreateJson: any = null;
  try {
    fileCreateJson = JSON.parse(fileCreateBodyText);
  } catch {
    throw new Error(`fileCreate failed: Non-JSON response (${fileCreateRes.status}) | Body: ${fileCreateBodyText}`);
  }
  const fileObj = fileCreateJson?.data?.fileCreate?.files?.[0];
  let shopifyImageUrl = fileObj?.preview?.image?.url ?? null;

  console.log(`[Shopify] Image upload: fileCreate returned id=${fileObj?.id}, fileStatus=${fileObj?.fileStatus}, preview.image.url=${fileObj?.preview?.image?.url ?? "null"}`);

  if (shopifyImageUrl) return shopifyImageUrl;
  if (fileObj?.fileStatus === "UPLOADED" && fileObj.id) {
    // Poll sur l'id MediaImage
    console.log(`[Shopify] Polling for CDN image url: MediaImage id=${fileObj.id}`);
    shopifyImageUrl = await pollShopifyImageCDNUrl(shop, token, fileObj.id);
    if (shopifyImageUrl) return shopifyImageUrl;
    console.warn(`[Shopify] CDN url not available after polling MediaImage id (trying fallback by filename)`);
    // Fallback: cherche dans Files par filename si CDN non trouvée
    shopifyImageUrl = await searchShopifyFileByFilename(shop, token, filename);
    if (shopifyImageUrl) return shopifyImageUrl;
  }
  if (fileCreateJson.data?.fileCreate?.userErrors?.length) {
    // Domaine bloqué : staged upload classique
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("download image error");
    const buf = Buffer.from(await imgRes.arrayBuffer());
    // Sauvegarde temporaire
    const tempPath = path.join("/tmp", filename.replace(/[^\w\.-]/g, "_"));
    fs.writeFileSync(tempPath, buf);
    let cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
    if (!cdnUrl) {
      console.warn(`[Shopify] CDN url not available after staged upload for ${filename}`);
      // Fallback: cherche dans Files par filename si CDN non trouvée
      cdnUrl = await searchShopifyFileByFilename(shop, token, filename);
    }
    return cdnUrl ?? null;
  }
  throw new Error(`Shopify fileCreate failed | Response: ${fileCreateBodyText}`);
}

async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
) {
  console.log(`[Shopify] Attaching image to productId=${productId}: imageUrl=${imageUrl ?? "null"}, altText="${altText}"`);
  const media = [
    {
      originalSource: imageUrl,
      mediaContentType: "IMAGE",
      alt: altText,
    },
  ];
  const res = await fetch(
    `https://${shop}/admin/api/2025-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              id
              status
              preview {
                image {
                  url
                }
              }
              mediaErrors {
                code
                message
              }
            }
            mediaUserErrors {
              code
              message
            }
          }
        }
        `,
        variables: { productId, media },
      }),
    }
  );
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `productCreateMedia failed: Non-JSON response (${res.status}) | Body: ${bodyText}`
    );
  }
  const mediaObj = json?.data?.productCreateMedia?.media?.[0];
  console.log(`[Shopify] productCreateMedia response: status=${mediaObj?.status}, url=${mediaObj?.preview?.image?.url ?? "null"}, mediaErrors=${JSON.stringify(mediaObj?.mediaErrors)}`);
  if (json.data?.productCreateMedia?.mediaUserErrors?.length) {
    console.error(`[Shopify] mediaUserErrors:`, JSON.stringify(json.data.productCreateMedia.mediaUserErrors));
  }
  return json;
}

/**
 * Attache l'image à une variante Shopify
 */
async function attachImageToVariant(shop: string, token: string, variantId: string, imageUrl: string, altText: string = "") {
  console.log(`[Shopify] Attaching image to variantId=${variantId}: imageUrl=${imageUrl ?? "null"}, altText="${altText}"`);
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantUpdate($input: ProductVariantUpdateInput!) {
          productVariantUpdate(input: $input) {
            productVariant { id image { id src altText } }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: {
          id: variantId,
          image: { src: imageUrl, altText }
        }
      }
    })
  });
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`productVariantUpdate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.productVariantUpdate?.userErrors?.length) {
    console.error("Erreur productVariantUpdate:", JSON.stringify(json.data.productVariantUpdate.userErrors));
  }
  return json;
}

/**
 * Fonction principale : crée les produits à partir du CSV et attache les images (upload universel + fallback filename pour trouver la URL CDN Shopify).
 */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      type ProductOption = { name: string, values: { name: string }[] };
      type VariantNode = {
        id?: string;
        selectedOptions?: { name: string, value: string }[];
        [key: string]: unknown;
      };

      const optionValues1: { name: string }[] = [...new Set(group.map(row => (row["Option1 Value"] || "").trim()))]
        .filter(v => !!v && v !== "Default Title")
        .map(v => ({ name: v }));
      const optionValues2: { name: string }[] = [...new Set(group.map(row => (row["Option2 Value"] || "").trim()))]
        .filter(v => !!v && v !== "Default Title")
        .map(v => ({ name: v }));
      const optionValues3: { name: string }[] = [...new Set(group.map(row => (row["Option3 Value"] || "").trim()))]
        .filter(v => !!v && v !== "Default Title")
        .map(v => ({ name: v }));

      const productOptions: ProductOption[] = [];
      if (main["Option1 Name"] && optionValues1.length) {
        productOptions.push({ name: main["Option1 Name"].trim(), values: optionValues1 });
      }
      if (main["Option2 Name"] && optionValues2.length) {
        productOptions.push({ name: main["Option2 Name"].trim(), values: optionValues2 });
      }
      if (main["Option3 Name"] && optionValues3.length) {
        productOptions.push({ name: main["Option3 Name"].trim(), values: optionValues3 });
      }
      const productOptionsOrUndefined = productOptions.length ? productOptions : undefined;

      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

      const product: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
        productOptions: productOptionsOrUndefined,
      };

      try {
        // Création du produit
        const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({
            query: `
              mutation productCreate($product: ProductCreateInput!) {
                productCreate(product: $product) {
                  product {
                    id
                    title
                    handle
                    variants(first: 50) {
                      edges { node { id sku title selectedOptions { name value } } }
                    }
                    options { id name position optionValues { id name hasVariants } }
                  }
                  userErrors { field message }
                }
              }
            `,
            variables: { product },
          }),
        });

        const gqlBodyText = await gqlRes.text();
        let gqlJson: any = null;
        try {
          gqlJson = JSON.parse(gqlBodyText);
        } catch {
          throw new Error(`productCreate failed: Non-JSON response (${gqlRes.status}) | Body: ${gqlBodyText}`);
        }

        const productData = gqlJson?.data?.productCreate?.product;
        const productId = productData?.id;
        const userErrors = gqlJson?.data?.productCreate?.userErrors ?? [];
        if (!productId) {
          console.error(
            "Aucun productId généré.",
            "userErrors:", userErrors.length > 0 ? userErrors : "Aucune erreur Shopify.",
            "Réponse brute:", JSON.stringify(gqlJson, null, 2)
          );
          continue;
        }
        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

        // Upload et attache image principale
        const productImageUrl = main["Image Src"];
        const imageAltText = main["Image Alt Text"] ?? "";
        if (productImageUrl && !productImageUrl.startsWith("https://cdn.shopify.com")) {
          try {
            const filename = productImageUrl.split('/').pop() ?? 'image.jpg';
            let cdnUrl = await uploadImageToShopifyUniversal(shop, token, productImageUrl, filename);
            if (!cdnUrl) {
              console.warn(`CDN url not available for [${handle}] (productId: ${productId})`);
            }
            await attachImageToProduct(shop, token, productId, cdnUrl ?? "", imageAltText);
            console.log(`Image rattachée au produit: ${handle} → ${productId}`);
          } catch (err) {
            console.error("Erreur upload/attach image produit", handle, err);
          }
        }

        // Création/gestion variants et attachement images des variantes
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = handle + ":" +
            (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          const variantCsvRow = group.find(row =>
            [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
            .filter(Boolean)
            .join(":") === (v.selectedOptions ?? []).map(opt => opt.value).join(":")
          );
          if (
            variantCsvRow &&
            v.id &&
            variantCsvRow["Variant Image"] &&
            !variantCsvRow["Variant Image"].startsWith("https://cdn.shopify.com")
          ) {
            let variantImageUrl = variantCsvRow["Variant Image"];
            let variantAltText = variantCsvRow["Image Alt Text"] ?? "";
            try {
              const filename = variantImageUrl.split('/').pop() ?? 'variant.jpg';
              let cdnUrl = await uploadImageToShopifyUniversal(shop, token, variantImageUrl, filename);
              if (!cdnUrl) {
                console.warn(`CDN url not available for variante [${variantKey}]`);
              }
              await attachImageToVariant(shop, token, v.id, cdnUrl ?? "", variantAltText);
              console.log(`Image rattachée à variante: ${variantKey} → ${v.id}`);
            } catch (err) {
              console.error("Erreur upload/attach image variante", variantKey, err);
            }
          }
        }
        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
