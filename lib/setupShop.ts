import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile } from "./batchUploadUniversal";
import { fetch } from "undici";

// Helper: Detects delimiter ; or ,
function guessCsvDelimiter(csvText) {
  const firstLine = csvText.split("\n")[0];
  return firstLine.includes(";") ? ";" : ",";
}

// Helper: Valid image URL
function validImageUrl(url) {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

// Upload and return CDN Shopify URL, from HTTP image to staged upload (with fallback)
async function uploadImageToShopify(shop, token, imageUrl, filename) {
  if (imageUrl.startsWith("https://cdn.shopify.com")) return imageUrl;
  const mimeType =
    filename.endsWith(".png") ? "image/png" :
    filename.endsWith(".webp") ? "image/webp" :
    "image/jpeg";
  try {
    // Download remote image to buffer
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Image inaccessible: " + imageUrl);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    // Write to temp file then do staged upload (for maximum compatibility)
    const tempPath = path.join("/tmp", filename.replace(/[^\w.\-]/g, "_"));
    fs.writeFileSync(tempPath, buf);
    const cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
    return cdnUrl;
  } catch (err) {
    console.error("[Shopify] ERROR uploadImageToShopify", imageUrl, err);
    return null;
  }
}

export async function ShopSetup({ shop, token }) {
  try {
    // 1. Fetch online CSV (products)
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    console.log(`[Shopify] ShopSetup: parsed delimiter=${delimiter}`);

    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

    // 2. Group products by handle
    const productsByHandle = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // 3. For each product, create it and attach images/variants
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      // Build Shopify product options
      const getOptionValues = opt =>
        [...new Set(group.map(r => (r[opt] || "").trim()))]
          .filter(v => !!v && v !== "Default Title")
          .map(v => ({ name: v }));

      const productOptions1 = getOptionValues("Option1 Value");
      const productOptions2 = getOptionValues("Option2 Value");
      const productOptions3 = getOptionValues("Option3 Value");

      const productOptions = [];
      if (main["Option1 Name"] && productOptions1.length)
        productOptions.push({ name: main["Option1 Name"].trim(), values: productOptions1 });
      if (main["Option2 Name"] && productOptions2.length)
        productOptions.push({ name: main["Option2 Name"].trim(), values: productOptions2 });
      if (main["Option3 Name"] && productOptions3.length)
        productOptions.push({ name: main["Option3 Name"].trim(), values: productOptions3 });

      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

      const productData = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags ? main.Tags.split(",").map(t => t.trim()) : [],
        productOptions: productOptions.length ? productOptions : undefined,
      };

      // --- Create Product ---
      let createdProductId = null;
      let createdVariantsArr = [];
      try {
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
                    variants(first: 50) { edges { node { id sku title selectedOptions { name value } } } }
                    options { id name position optionValues { id name hasVariants } }
                  }
                  userErrors { field message }
                }
              }
            `,
            variables: { product: productData },
          }),
        });

        const gqlBodyText = await gqlRes.text();
        const gqlJson = JSON.parse(gqlBodyText);
        const product = gqlJson?.data?.productCreate?.product;
        createdProductId = product?.id;
        createdVariantsArr = product?.variants?.edges?.map(e => e.node) ?? [];
        if (!createdProductId) {
          console.error("Failed to create product for handle:", handleUnique, gqlBodyText);
          continue;
        }
        console.log(`[Shopify] Created product: ${handleUnique} → ${createdProductId}`);
      } catch (err) {
        console.error("Product creation error", handleUnique, err);
        continue;
      }

      // --- Upload and Attach Product Images ---
      for (const row of group) {
        const imageUrl = row["Image Src"];
        const imageAltText = row["Image Alt Text"] || "";
        if (validImageUrl(imageUrl)) {
          const filename = imageUrl.split("/").pop();
          try {
            const cdnUrl = await uploadImageToShopify(shop, token, imageUrl, filename);
            if (cdnUrl) {
              // Attach image to product
              await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Shopify-Access-Token": token,
                },
                body: JSON.stringify({
                  query: `
                    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
                      productCreateMedia(productId: $productId, media: $media) {
                        media { id status preview { image { url } } }
                        mediaUserErrors { code message }
                      }
                    }
                  `,
                  variables: {
                    productId: createdProductId,
                    media: [{
                      originalSource: cdnUrl,
                      mediaContentType: "IMAGE",
                      alt: imageAltText
                    }]
                  }
                }),
              });
              console.log(`[Shopify] Product image attached: ${filename}`);
            }
          } catch (err) {
            console.error("[Shopify] Image upload/attach failed", filename, err);
          }
        }
      }

      // --- Upload and Attach Variant Images ---
      for (const v of createdVariantsArr) {
        const variantKey = (v.selectedOptions || []).map(opt => opt.value).join(":");
        const matchingRows = group.filter(row =>
          [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
            .filter(Boolean)
            .join(":") === variantKey
        );
        for (const variantCsvRow of matchingRows) {
          const variantImageUrl = variantCsvRow["Variant Image"];
          const variantAltText = variantCsvRow["Image Alt Text"] || "";
          if (validImageUrl(variantImageUrl)) {
            const filename = variantImageUrl.split("/").pop();
            try {
              const cdnUrl = await uploadImageToShopify(shop, token, variantImageUrl, filename);
              if (cdnUrl) {
                // Attach image to variant
                await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": token,
                  },
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
                        id: v.id,
                        image: { src: cdnUrl, altText: variantAltText }
                      }
                    }
                  }),
                });
                console.log(`[Shopify] Variant image attached: ${filename} → ${v.id}`);
              }
            } catch (err) {
              console.error("[Shopify] Variant image upload/attach failed", filename, err);
            }
          }
        }
      }

      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.error("[Shopify] SetupShop ERROR:", err);
  }
}
