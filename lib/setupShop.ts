import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile } from "./batchUploadUniversal";
import { fetch } from "undici";

/** Détecte le séparateur du CSV ("," ou ";") */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.includes(";") ? ";" : ",";
}

/** Vérifie la validité de l'URL d'image */
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

/** Attache une image à un produit Shopify */
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
      variables: { productId, media },
    }),
  });
}

/** Attache une image à une variante Shopify */
export async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
) {
  await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
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
          image: { src: imageUrl, altText },
        },
      },
    }),
  });
}

/** Fonction principale: setup du shop - création produits, upload images, associations */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

    // Regroupe les produits par handle
    const productsByHandle: Record<string, any[]> = {};
    records.forEach(row => {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    });

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      // Prépare les options du produit Shopify
      const makeOptions = (opt: string) =>
        [...new Set(group.map(row => (row[opt] || "").trim()))]
          .filter(v => !!v && v !== "Default Title")
          .map(v => ({ name: v }));

      const optionValues1 = makeOptions("Option1 Value");
      const optionValues2 = makeOptions("Option2 Value");
      const optionValues3 = makeOptions("Option3 Value");

      const productOptions: { name: string; values: { name: string }[] }[] = [];
      if (main["Option1 Name"] && optionValues1.length)
        productOptions.push({ name: main["Option1 Name"].trim(), values: optionValues1 });
      if (main["Option2 Name"] && optionValues2.length)
        productOptions.push({ name: main["Option2 Name"].trim(), values: optionValues2 });
      if (main["Option3 Name"] && optionValues3.length)
        productOptions.push({ name: main["Option3 Name"].trim(), values: optionValues3 });

      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

      const productData: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags ? main.Tags.split(",").map((t: string) => t.trim()) : [],
        productOptions: productOptions.length ? productOptions : undefined,
      };

      // Création produit Shopify
      let productId: string | undefined;
      let createdVariantsArr: any[] = [];
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
                    variants(first: 50) { edges { node { id selectedOptions { name value } } } }
                    options { id name position optionValues { id name hasVariants } }
                  }
                  userErrors { field message }
                }
              }
            `,
            variables: { product: productData },
          }),
        });
        const gqlJson = await gqlRes.json() as any;
        const product = gqlJson?.data?.productCreate?.product;
        productId = product?.id;
        createdVariantsArr = product?.variants?.edges?.map((e: any) => e.node) ?? [];
        if (!productId) {
          console.error(`[Shopify] Product not created for handle: ${handleUnique}`);
          continue;
        }
        console.log(`[Shopify] Product created: ${handleUnique} → ${productId}`);
      } catch (err) {
        console.error("Error creating product:", handleUnique, err);
        continue;
      }

      // Upload et attache images produit
      for (const row of group) {
        const imageUrl = row["Image Src"];
        const imageAltText = row["Image Alt Text"] ?? "";
        if (validImageUrl(imageUrl)) {
          const filename = imageUrl.split("/").pop();
          try {
            // Download image to Buffer, write to tmp, upload to Shopify stagedFiles
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) throw new Error("Image inaccessible: " + imageUrl);
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const tempPath = path.join("/tmp", filename?.replace(/[^\w.\-]/g, "_") ?? "image.jpg");
            fs.writeFileSync(tempPath, buf);
            const cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
            if (cdnUrl) {
              await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
              console.log(`[Shopify] Product image attached: ${filename}`);
            }
          } catch (err) {
            console.error("Image upload/attach failed", filename, err);
          }
        }
      }

      // Upload et attache images variantes
      for (const v of createdVariantsArr) {
        const variantKey = (v.selectedOptions || []).map((opt: any) => opt.value).join(":");
        const matchingRows = group.filter(row =>
          [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
            .filter(Boolean)
            .join(":") === variantKey
        );
        for (const variantCsvRow of matchingRows) {
          const variantImageUrl = variantCsvRow["Variant Image"];
          const variantAltText = variantCsvRow["Image Alt Text"] ?? "";
          if (validImageUrl(variantImageUrl)) {
            const filename = variantImageUrl.split("/").pop();
            try {
              const imgRes = await fetch(variantImageUrl);
              if (!imgRes.ok) throw new Error("Image inaccessible: " + variantImageUrl);
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const tempPath = path.join("/tmp", filename?.replace(/[^\w.\-]/g, "_") ?? "variant.jpg");
              fs.writeFileSync(tempPath, buf);
              const cdnUrl = await stagedUploadShopifyFile(shop, token, tempPath);
              if (cdnUrl && v.id) {
                await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
                console.log(`[Shopify] Variant image attached: ${filename} → ${v.id}`);
              }
            } catch (err) {
              console.error("Variant image upload/attach failed", filename, err);
            }
          }
        }
      }

      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.error("[Shopify] setupShop ERROR:", err);
  }
}
