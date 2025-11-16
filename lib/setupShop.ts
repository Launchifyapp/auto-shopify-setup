import { parse } from "csv-parse/sync";
import { Buffer } from "buffer";

/** Détecte le séparateur ; ou , pour CSV Shopify FR/EN */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/**
 * Upload une image sur Shopify:
 * - Tente mutation GraphQL fileCreate (originalSource sur URL)
 * - Si "processing error", fallback REST Files API en base64
 * Retourne l'URL CDN Shopify obtenue
 */
async function uploadImageToShopify(shop: string, token: string, imageUrl: string, filename: string): Promise<string> {
  if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;

  // 1. Tentative mutation GraphQL
  const graphRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { url }
            userErrors { field message }
          }
        }
      `,
      variables: {
        files: [{
          originalSource: imageUrl,
          originalFileName: filename,
          mimeType: imageUrl.endsWith('.png') ? "image/png"
            : imageUrl.endsWith('.webp') ? "image/webp"
            : "image/jpeg"
        }]
      }
    })
  });

  let graphJson;
  try {
    graphJson = await graphRes.json();
  } catch (err) {
    const errText = await graphRes.text();
    throw new Error(`Shopify img upload failed: Non-JSON response (${graphRes.status}) | Body: ${errText}`);
  }
  if (graphJson.data?.fileCreate?.files?.[0]?.url) {
    return graphJson.data.fileCreate.files[0].url;
  }

  // 2. Fallback : download + REST Files API en base64
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("download image error");
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buf.toString("base64");

  const restFilesRes = await fetch(`https://${shop}/admin/api/2023-07/files.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      file: {
        attachment: base64,
        filename,
        mime_type: imageUrl.endsWith('.png') ? "image/png"
          : imageUrl.endsWith('.webp') ? "image/webp"
          : "image/jpeg"
      }
    }),
  });

  let restJson;
  try {
    restJson = await restFilesRes.json();
  } catch (err) {
    const errText = await restFilesRes.text();
    throw new Error(`Shopify base64 upload failed: Non-JSON response (${restFilesRes.status}) | Body: ${errText}`);
  }
  if (restJson.file?.url) return restJson.file.url;
  throw new Error("Upload image failed for " + filename + " | GraphQL: " + JSON.stringify(graphJson) + " | REST: " + JSON.stringify(restJson));
}
  // 2. Fallback : download + REST Files API en base64
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("download image error");
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buf.toString("base64");
  const restFilesRes = await fetch(`https://${shop}/admin/api/2023-07/files.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      file: {
        attachment: base64,
        filename,
        mime_type: imageUrl.endsWith('.png') ? "image/png"
          : imageUrl.endsWith('.webp') ? "image/webp"
          : "image/jpeg"
      }
    }),
  });
  const restJson = await restFilesRes.json();
  if (restJson.file?.url) return restJson.file.url;
  throw new Error("Upload image failed for " + filename + " | GraphQL: " + JSON.stringify(graphJson) + " | REST: " + JSON.stringify(restJson));
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
  const json = await res.json();
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
  const json = await res.json();
  if (json.data?.productVariantUpdate?.userErrors?.length) {
    console.error("Erreur productVariantUpdate:", JSON.stringify(json.data.productVariantUpdate.userErrors));
  }
  return json;
}

/**
 * Fonction principale : crée les produits à partir du CSV et attache les images
 */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

    // Regroupe les lignes du CSV par Handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // Traitement produit par produit
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
        // Création produit Shopify
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
        const gqlJson = await gqlRes.json();
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
        // Filtre l'image déjà sur Shopify CDN !
        if (productImageUrl && !productImageUrl.startsWith("https://cdn.shopify.com")) {
          try {
            const cdnUrl = await uploadImageToShopify(shop, token, productImageUrl, productImageUrl.split('/').pop() ?? 'image.jpg');
            await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
            console.log(`Image rattachée au produit: ${handle} → ${productId}`);
          } catch (err) {
            console.error("Erreur upload/attach image produit", handle, err);
          }
        }

        // Création/gestion variants et attachement images des variantes
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        const createdVariantsCount = createdVariantsArr.length;

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
              const cdnUrl = await uploadImageToShopify(shop, token, variantImageUrl, variantImageUrl.split('/').pop() ?? 'variant.jpg');
              await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
              console.log(`Image rattachée à variante: ${variantKey} → ${v.id}`);
            } catch (err) {
              console.error("Erreur upload/attach image variante", variantKey, err);
            }
          }
        }

        const expectedVariantsCount = group.filter(row =>
          productOptions.some((opt, idx) =>
            row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim() !== "Default Title"
          )
        ).length;

        if (productOptionsOrUndefined && createdVariantsCount < expectedVariantsCount) {
          const alreadyCreatedKeys = new Set<string>(
            createdVariantsArr.map((v: VariantNode) =>
              (v.selectedOptions ?? [])
                .map(opt => (opt.value || "").toLocaleLowerCase())
                .join("/")
            )
          );

          const variants = group
            .filter(row => productOptions.some((opt, idx) =>
              row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim() !== "Default Title"
            ))
            .map(row => {
              const key = [
                row["Option1 Value"]?.trim().toLocaleLowerCase(),
                row["Option2 Value"]?.trim().toLocaleLowerCase(),
                row["Option3 Value"]?.trim().toLocaleLowerCase()
              ].filter(Boolean).join("/");

              if (alreadyCreatedKeys.has(key)) return undefined;
              const optionValues: { name: string; optionName: string }[] = [];
              productOptions.forEach((opt, idx) => {
                const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
                if (value && value !== "Default Title")
                  optionValues.push({ name: value, optionName: opt.name });
              });
              return {
                price: row["Variant Price"] || main["Variant Price"] || undefined,
                compareAtPrice: row["Variant Compare At Price"] || undefined,
                sku: row["Variant SKU"] || undefined,
                barcode: row["Variant Barcode"] || undefined,
                optionValues: optionValues.length ? optionValues : undefined,
              };
            })
            .filter(v => v && v.optionValues && v.optionValues.length);

          if (variants.length) {
            try {
              const bulkRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Shopify-Access-Token": token,
                },
                body: JSON.stringify({
                  query: `
                    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                      productVariantsBulkCreate(productId: $productId, variants: $variants) {
                        productVariants { id sku price }
                        userErrors { field message }
                      }
                    }
                  `,
                  variables: { productId, variants },
                }),
              });
              const bulkJson = await bulkRes.json();
              if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
                console.error('Bulk variants userErrors:', bulkJson.data.productVariantsBulkCreate.userErrors);
              } else {
                console.log('Bulk variants response:', JSON.stringify(bulkJson, null, 2));
              }
            } catch (err) {
              console.log('Erreur bulk variants GraphQL', handleUnique, err);
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
