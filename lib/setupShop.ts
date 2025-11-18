import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { fetch } from "undici";

// Exportée : pour assembler les images au produit
export async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
) {
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
  if (json.data?.productCreateMedia?.mediaUserErrors?.length) {
    console.error(`[Shopify] mediaUserErrors:`, JSON.stringify(json.data.productCreateMedia.mediaUserErrors));
  }
  return json;
}

// Exportée : pour assembler les images aux variantes
export async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
) {
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

// Exportée : upload universel, utilisée dans pipelineBulkShopify.ts
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
  try {
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

      // Appel de la logique batchUploadUniversal pour staged upload
      const { stagedUploadShopifyFile, pollShopifyFileCDNByFilename } = await import("./batchUploadUniversal");
      let cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
      if (!cdnUrl) {
        console.warn(`[Shopify] CDN url not available after staged upload for ${filename}`);
        cdnUrl = await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
      }
      return cdnUrl ?? null;
    }
    // Toujours polling CDN pour fallback
    const { pollShopifyFileCDNByFilename } = await import("./batchUploadUniversal");
    return await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
  } catch (err) {
    console.error("[Shopify] ERROR uploadImageToShopifyUniversal", err);
    return null;
  }
}

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

// Exportée : la pipeline principale (refactor batch optimisé)
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    console.log(`[Shopify] setupShop: parsed delimiter=${delimiter}`);

    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

    /** 1. Extraction batch images */
    const imagesMap = new Map<string, { url: string, filename: string, type: "product"|"variant", handle: string, altText: string }>();
    for (const row of records) {
      if (validImageUrl(row["Image Src"])) {
        const fname = row["Image Src"].split('/').pop() || "image.jpg";
        imagesMap.set(fname, {
          url: row["Image Src"],
          filename: fname,
          type: "product",
          handle: row.Handle,
          altText: row["Image Alt Text"] || ""
        });
      }
      if (validImageUrl(row["Variant Image"])) {
        const fnameVar = row["Variant Image"].split('/').pop() || "variant.jpg";
        imagesMap.set(fnameVar, {
          url: row["Variant Image"],
          filename: fnameVar,
          type: "variant",
          handle: row.Handle,
          altText: row["Image Alt Text"] || ""
        });
      }
    }

    /** 2. Batch upload toutes les images avant toute création produit/variante */
    const cdnUrlByFilename: Record<string, string> = {};
    for (const [fname, img] of imagesMap.entries()) {
      if (img.url.startsWith("https://cdn.shopify.com")) {
        cdnUrlByFilename[fname] = img.url;
        continue;
      }
      try {
        const cdnUrl = await uploadImageToShopifyUniversal(shop, token, img.url, img.filename);
        if (cdnUrl) {
          cdnUrlByFilename[fname] = cdnUrl;
        } else {
          console.warn(`setupShop batch: No CDN url for ${fname}`);
        }
      } catch (err) {
        console.error(`[setupShop BATCH FAIL] ${fname}:`, err);
      }
    }

    /** 3. Création des produits/variantes, linkage images ultra rapide car CDN déjà uploadé ! */
    // Regroupe chaque handle avec toutes ses lignes CSV
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

        // Attache toutes les images produit qui sont déjà sur le CDN
        for (const row of group) {
          const productImageUrl = row["Image Src"];
          const imageAltText = row["Image Alt Text"] ?? "";
          if (validImageUrl(productImageUrl)) {
            try {
              const filename = productImageUrl.split('/').pop() ?? 'image.jpg';
              const cdnUrl = cdnUrlByFilename[filename];
              if (!cdnUrl) {
                console.warn(`Image produit non uploadée : ${filename}`);
                continue;
              }
              await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
              console.log(`Image rattachée au produit: ${handle} (row) → ${productId}`);
            } catch (err) {
              console.error("Erreur linkage image produit", handle, err);
            }
          }
        }

        // Attache toutes les images variantes
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          const matchingRows = group.filter(row =>
            [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
              .filter(Boolean)
              .join(":") === variantKey
          );
          for (const variantCsvRow of matchingRows) {
            const variantImageUrl = variantCsvRow?.["Variant Image"];
            const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
            if (
              v.id &&
              validImageUrl(variantImageUrl)
            ) {
              try {
                const filename = variantImageUrl.split('/').pop() ?? 'variant.jpg';
                const cdnUrl = cdnUrlByFilename[filename];
                if (!cdnUrl) {
                  console.warn(`Image variante non uploadée : ${filename}`);
                  continue;
                }
                await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
                console.log(`Image rattachée à variante: ${variantKey} → ${v.id}`);
              } catch (err) {
                console.error("Erreur linkage image variante", variantKey, err);
              }
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
