import { parse } from "csv-parse/sync";
import { Buffer } from "buffer";
import path from "path";
import fs from "fs";

/**
 * Détecte le séparateur ; ou , pour CSV Shopify FR/EN
 */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/**
 * Shopify staged upload workflow:
 * 1. Request pre-signed S3 upload URL with stagedUploadsCreate
 * 2. POST file to S3 URL with provided fields
 * 3. Call fileCreate using S3 resourceUrl
 */
async function getStagedUploadUrl(shop: string, token: string, filename: string, mimeType: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      query: `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              url
              resourceUrl
              parameters { name value }
            }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: [{
          filename,
          mimeType,
          resource: "FILE"
        }]
      }
    })
  });

  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`stagedUploadsCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (!json?.data?.stagedUploadsCreate?.stagedTargets?.[0]) {
    throw new Error("stagedUploadsCreate returned no stagedTargets: " + JSON.stringify(json));
  }
  return json.data.stagedUploadsCreate.stagedTargets[0];
}

/**
 * Upload le fichier en POST multipart vers S3
 */
async function uploadToStagedUrl(stagedTarget: any, fileBuffer: Buffer, mimeType: string) {
  const formData = new FormData();
  for (const param of stagedTarget.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append('file', fileBuffer, { type: mimeType });

  const res = await fetch(stagedTarget.url, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`S3 upload failed: ${res.status} | ${errText}`);
  }
  return stagedTarget.resourceUrl;
}

/**
 * Crée le fichier Shopify via fileCreate, source = staged resourceUrl S3
 */
async function fileCreateFromStaged(shop: string, token: string, resourceUrl: string, filename: string, mimeType: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { url fileStatus }
            userErrors { field message }
          }
        }
      `,
      variables: {
        files: [{
          originalSource: resourceUrl,
          originalFileName: filename,
          mimeType
        }]
      }
    })
  });
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`fileCreate failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.fileCreate?.files?.[0]?.url) {
    return json.data.fileCreate.files[0].url;
  }
  if (json.data?.fileCreate?.userErrors?.length) {
    throw new Error('File create userErrors: ' + JSON.stringify(json.data.fileCreate.userErrors));
  }
  throw new Error(`fileCreate failed | Response: ${bodyText}`);
}

/**
 * Upload universel : directe par URL si accepté, sinon staged upload Shopify
 * Si tu passes une url locale, télécharge puis upload; sinon upload staged sur download remote image
 */
async function uploadImageToShopifyUniversal(shop: string, token: string, imageUrl: string, filename: string): Promise<string> {
  if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;

  // 1. Tentative fileCreate direct par URL
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";

  const fileCreateRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { url fileStatus }
            userErrors { field message }
          }
        }
      `,
      variables: {
        files: [{
          originalSource: imageUrl,
          originalFileName: filename,
          mimeType
        }]
      }
    })
  });
  const fileCreateBodyText = await fileCreateRes.text();
  let fileCreateJson: any = null;
  try {
    fileCreateJson = JSON.parse(fileCreateBodyText);
  } catch {
    throw new Error(`fileCreate failed: Non-JSON response (${fileCreateRes.status}) | Body: ${fileCreateBodyText}`);
  }

  // Si succès direct
  if (fileCreateJson.data?.fileCreate?.files?.[0]?.url) {
    return fileCreateJson.data.fileCreate.files[0].url;
  }
  // Si userError, refuse le domaine → staged upload
  if (fileCreateJson.data?.fileCreate?.userErrors?.length) {
    // Download image en mémoire
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("download image error");
    const buf = Buffer.from(await imgRes.arrayBuffer());

    // Step 1: stagedUploadsCreate
    const stagedTarget = await getStagedUploadUrl(shop, token, filename, mimeType);

    // Step 2: Upload to S3
    const resourceUrl = await uploadToStagedUrl(stagedTarget, buf, mimeType);

    // Step 3: fileCreate using S3 URL
    return await fileCreateFromStaged(shop, token, resourceUrl, filename, mimeType);
  }

  throw new Error(`Shopify fileCreate failed | Response: ${fileCreateBodyText}`);
}

/**
 * Attache l'image à un produit Shopify via GraphQL productCreateMedia
 */
async function attachImageToProduct(shop: string, token: string, productId: string, imageUrl: string, altText: string = "") {
  const media = [{
    originalSource: imageUrl,
    mediaContentType: "IMAGE",
    alt: altText
  }];
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Shopify-Access-Token": token},
    body: JSON.stringify({
      query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { id alt }
            userErrors { field message }
          }
        }
      `,
      variables: { productId, media }
    })
  });
  const bodyText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`productCreateMedia failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  if (json.data?.productCreateMedia?.userErrors?.length) {
    console.error("Erreur productCreateMedia:", JSON.stringify(json.data.productCreateMedia.userErrors));
  }
  return json;
}

/**
 * Attache l'image à une variante Shopify
 */
async function attachImageToVariant(shop: string, token: string, variantId: string, imageUrl: string, altText: string = "") {
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
 * Fonction principale : crée les produits à partir du CSV et attache les images avec upload universel
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

        // Upload image et rattachement produit
        const productImageUrl = main["Image Src"];
        const imageAltText = main["Image Alt Text"] ?? "";
        if (productImageUrl && !productImageUrl.startsWith("https://cdn.shopify.com")) {
          try {
            const cdnUrl = await uploadImageToShopifyUniversal(shop, token, productImageUrl, productImageUrl.split('/').pop() ?? 'image.jpg');
            await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
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
              const cdnUrl = await uploadImageToShopifyUniversal(shop, token, variantImageUrl, variantImageUrl.split('/').pop() ?? 'variant.jpg');
              await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
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
