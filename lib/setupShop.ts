import { parse } from "csv-parse/sync";
import { Buffer } from "buffer";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile, searchShopifyFileByFilename, pollShopifyFileCDNByFilename } from "./batchUploadUniversal";
import { fetch } from "undici";

/** Détecter le séparateur ; ou , pour CSV Shopify FR/EN */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/** Vérifie que l'URL d'image est valide (ignore "nan", "null", "undefined", vide) */
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

/**
 * Attache une image à un produit Shopify
 */
export async function attachImageToProduct(
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
    throw new Error(`productCreateMedia failed: Non-JSON response (${res.status}) | Body: ${bodyText}`);
  }
  const mediaObj = json?.data?.productCreateMedia?.media?.[0];
  console.log(`[Shopify] productCreateMedia response: status=${mediaObj?.status}, url=${mediaObj?.preview?.image?.url ?? "null"}, mediaErrors=${JSON.stringify(mediaObj?.mediaErrors)}`);
  if (json.data?.productCreateMedia?.mediaUserErrors?.length) {
    console.error(`[Shopify] mediaUserErrors:`, JSON.stringify(json.data.productCreateMedia.mediaUserErrors));
  }
  return json;
}

/**
 * Attache une image à une variante Shopify
 */
export async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
) {
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
 * Upload universel: directe par URL (GraphQL fileCreate) si le domaine est accepté, sinon staged upload Shopify.
 * Récupération CDN : toujours avec polling!
 */
export async function uploadImageToShopifyUniversal(
  shop: string,
  token: string,
  imageUrl: string,
  filename: string
): Promise<string | null> {
  if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;
  const mimeType =
    filename.endsWith('.png') ? "image/png"
    : filename.endsWith('.webp') ? "image/webp"
    : "image/jpeg";
  console.log(`[Shopify] uploadImageToShopifyUniversal: uploading/creating ${filename}`);
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
    console.error(`[Shopify] fileCreate ERROR: ${fileCreateBodyText}`);
    throw new Error(`fileCreate failed: Non-JSON response (${fileCreateRes.status}) | Body: ${fileCreateBodyText}`);
  }
  if (fileCreateJson.data?.fileCreate?.userErrors?.length) {
    console.error('[Shopify] fileCreate userErrors:', JSON.stringify(fileCreateJson.data.fileCreate.userErrors));
    // Domaine bloqué : staged upload classique
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("download image error");
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const tempPath = path.join("/tmp", filename.replace(/[^\w\.-]/g, "_"));
    fs.writeFileSync(tempPath, buf);
    let cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
    if (!cdnUrl) {
      console.warn(`[Shopify] CDN url not available after staged upload for ${filename}`);
      cdnUrl = await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
    }
    return cdnUrl ?? null;
  }
  // Toujours polling CDN pour fallback
  return await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 2);
}

/**
 * Fonction principale exportée pour l'API / le handler Next.js
 */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    console.log(`[Shopify] setupShop: parsed delimiter=${delimiter}`);

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
        console.log(`[Shopify] Creating product: ${handleUnique}`);
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
          console.error(`[Shopify] productCreate ERROR: ${gqlBodyText}`);
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
        if (validImageUrl(productImageUrl) && !productImageUrl.startsWith("https://cdn.shopify.com")) {
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
          const variantImageUrl = variantCsvRow?.["Variant Image"];
          const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
          if (
            variantCsvRow &&
            v.id &&
            validImageUrl(variantImageUrl) &&
            !variantImageUrl.startsWith("https://cdn.shopify.com")
          ) {
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
