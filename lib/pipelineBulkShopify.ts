import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { fetch } from "undici";
import { stagedUploadShopifyFile, pollShopifyFileCDNByFilename, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";

/** CSV delimiter ; ou , */
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

/** Validation URL image */
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const val = url.trim().toLowerCase();
  return !!val && val !== "nan" && val !== "null" && val !== "undefined";
}

/** Batch upload d'images sans polling CDN */
export async function batchUploadImageToShopify(shop: string, token: string, url: string, filename: string) {
  if (url.startsWith("https://cdn.shopify.com")) return;
  try {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error("Erreur téléchargement image " + url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const tempPath = path.join("/tmp", filename.replace(/[^\w\.-]/g, "_"));
    fs.writeFileSync(tempPath, buf);
    await stagedUploadShopifyFile(shop, token, tempPath);
    // No polling here!
  } catch (err) {
    console.error(`[pipelineBulkShopify BatchUpload FAIL] ${filename}:`, err);
  }
}

/**
 * Pipeline batch upload : 1. upload images, 2. création produits/variants, 3. polling CDN + linkage image
 */
export async function pipelineBulkShopifyBatch({ shop, token }: { shop: string; token: string }) {
  // 1. Fetch CSV
  console.log("[Shopify] pipelineBulkShopifyBatch: fetch CSV...");
  const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  const delimiter = guessCsvDelimiter(csvText);
  console.log(`[Shopify] pipeline: parsed delimiter=${delimiter}`);

  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter });

  // 2. Batch upload images (no polling!)
  const imagesToUpload: { url: string; filename: string }[] = [];
  for (const row of records) {
    if (validImageUrl(row["Image Src"])) {
      imagesToUpload.push({
        url: row["Image Src"],
        filename: row["Image Src"].split('/').pop() || "image.jpg"
      });
    }
    if (validImageUrl(row["Variant Image"])) {
      imagesToUpload.push({
        url: row["Variant Image"],
        filename: row["Variant Image"].split('/').pop() || "variant.jpg"
      });
    }
  }
  for (const img of imagesToUpload) {
    await batchUploadImageToShopify(shop, token, img.url, img.filename);
  }

  // 3. Regrouper produits/handles
  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
    productsByHandle[row.Handle].push(row);
  }

  // 4. Créer produits et variants, polling CDN et attachement à chaud
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
      // Création produit
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

      // Images produit : polling CDN au moment du linkage
      for (const row of group) {
        const productImageUrl = row["Image Src"];
        const imageAltText = row["Image Alt Text"] ?? "";
        if (validImageUrl(productImageUrl)) {
          try {
            const filename = productImageUrl.split('/').pop() ?? 'image.jpg';
            let cdnUrl: string | null = productImageUrl.startsWith("https://cdn.shopify.com")
              ? productImageUrl
              : await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
            if (!cdnUrl) {
              console.warn(`Image produit non trouvée CDN : ${filename}`);
              continue;
            }
            await attachImageToProduct(shop, token, productId, cdnUrl, imageAltText);
          } catch (err) {
            console.error("Erreur linkage image produit", handle, err);
          }
        }
      }

      // Lien images variantes (polling CDN à l'attachement)
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
          if (v.id && validImageUrl(variantImageUrl)) {
            try {
              const filename = variantImageUrl.split('/').pop() ?? 'variant.jpg';
              let cdnUrl: string | null = variantImageUrl.startsWith("https://cdn.shopify.com")
                ? variantImageUrl
                : await pollShopifyFileCDNByFilename(shop, token, filename, 10000, 40);
              if (!cdnUrl) {
                console.warn(`Image variante non trouvée CDN : ${filename}`);
                continue;
              }
              await attachImageToVariant(shop, token, v.id, cdnUrl, variantAltText);
            } catch (err) {
              console.error("Erreur linkage image variante", variantKey, err);
            }
          }
        }
      }
      await new Promise(res => setTimeout(res, 200));
    } catch (err) {
      console.log('Erreur création produit GraphQL', handleUnique, err);
    }
  }

  console.log("[Shopify] pipelineBulkShopifyBatch: DONE.");
}
