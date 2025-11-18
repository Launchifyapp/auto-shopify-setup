import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { stagedUploadShopifyFile } from "./batchUploadUniversal";
import { fetch } from "undici";

// Détecte automatiquement le séparateur du CSV
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

// Vérifie la validité d'une URL d'image
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

// Fonction pour attacher une image à un produit Shopify
export async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
) {
  // ...implementation conservée
}

// Fonction pour attacher une image à une variante Shopify
export async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
) {
  // ...implementation conservée
}

// Pipeline principal : upload images et mapping, puis création des produits/variantes
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Parse le CSV d'URL d'images
    const csvPath = path.resolve("public", "Products_images-url.csv");
    const csvText = fs.readFileSync(csvPath, "utf8");
    const delimiter = guessCsvDelimiter(csvText);
    const records = parse(csvText, { columns: false, skip_empty_lines: true, delimiter });

    // 2. Upload toutes les images du CSV en buffer
    const cdnMapping: Record<string, string> = {};
    for (const row of records.slice(1)) { // skip header
      const imageUrl = row[1];
      if (!validImageUrl(imageUrl)) continue;
      const filename = imageUrl.split("/").pop();
      const mimeType =
        filename?.endsWith('.png') ? "image/png"
        : filename?.endsWith('.webp') ? "image/webp"
        : "image/jpeg";
      if (!filename || cdnMapping[filename]) continue;
      try {
        console.log(`[UPLOAD] Start ${filename}`);
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error("Image inaccessible: " + imageUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        const cdnUrl = await stagedUploadShopifyFile(shop, token, buf, filename, mimeType);
        if (cdnUrl) {
          cdnMapping[filename] = cdnUrl;
          console.log(`[UPLOAD] ${filename} → ${cdnUrl}`);
        } else {
          console.warn(`[UPLOAD] ${filename} → No CDN url found`);
        }
      } catch (err) {
        console.error(`[FAIL upload] ${filename}:`, err);
      }
    }

    // 3. Parse le CSV produits/variantes
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const productsCsvText = await response.text();
    const productsDelimiter = guessCsvDelimiter(productsCsvText);
    const productsRecords = parse(productsCsvText, { columns: true, skip_empty_lines: true, delimiter: productsDelimiter });

    // 4. Regroupe les produits par handle
    const productsByHandle: Record<string, any[]> = {};
    for (const row of productsRecords) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // 5. Pour chaque produit, crée le produit Shopify et attache les images/variantes
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      type ProductOption = { name: string, values: { name: string }[] };
      type VariantNode = {
        id?: string;
        selectedOptions?: { name: string, value: string }[];
        [key: string]: unknown;
      };

      // Prépare les options produits
      const optionValues1: { name: string }[] = [...new Set(group.map(r => (r["Option1 Value"] || "").trim()))]
        .filter(v => !!v && v !== "Default Title")
        .map(v => ({ name: v }));
      const optionValues2: { name: string }[] = [...new Set(group.map(r => (r["Option2 Value"] || "").trim()))]
        .filter(v => !!v && v !== "Default Title")
        .map(v => ({ name: v }));
      const optionValues3: { name: string }[] = [...new Set(group.map(r => (r["Option3 Value"] || "").trim()))]
        .filter(v => !!v && v !== "Default Title")
        .map(v => ({ name: v }));

      const productOptions: ProductOption[] = [];
      if (main["Option1 Name"] && optionValues1.length) productOptions.push({ name: main["Option1 Name"].trim(), values: optionValues1 });
      if (main["Option2 Name"] && optionValues2.length) productOptions.push({ name: main["Option2 Name"].trim(), values: optionValues2 });
      if (main["Option3 Name"] && optionValues3.length) productOptions.push({ name: main["Option3 Name"].trim(), values: optionValues3 });
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
        // Création du produit via Shopify GraphQL
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
            variables: { product }
          }),
        });

        const gqlBodyText = await gqlRes.text();
        let gqlJson: any = null;
        try { gqlJson = JSON.parse(gqlBodyText); } catch {}
        const productData = gqlJson?.data?.productCreate?.product;
        const productId = productData?.id;
        if (!productId) continue;

        // Attache toutes les images PRODUIT
        for (const r of group) {
          const productImageFilename = r["Image Src"]?.split("/").pop();
          const imageAltText = r["Image Alt Text"] ?? "";
          const productCdnUrl = productImageFilename ? cdnMapping[productImageFilename] : null;
          if (productCdnUrl) {
            try {
              await attachImageToProduct(shop, token, productId, productCdnUrl, imageAltText);
              console.log(`[CSV→CDN] Produit ${handle} image ${productImageFilename} attachée`);
            } catch (err) {
              console.error("Erreur attach image produit", handle, err);
            }
          }
        }

        // Attache toutes les images VARIANTES
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = handle + ":" + (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          const matchingVariantRows = group.filter(r =>
            [r["Option1 Value"], r["Option2 Value"], r["Option3 Value"]]
              .filter(Boolean)
              .join(":") === (v.selectedOptions ?? []).map(opt => opt.value).join(":")
          );
          for (const variantCsvRow of matchingVariantRows) {
            const variantImageFilename = variantCsvRow?.["Variant Image"]?.split("/").pop();
            const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
            const variantCdnUrl = variantImageFilename ? cdnMapping[variantImageFilename] : null;
            if (variantCdnUrl && v.id) {
              try {
                await attachImageToVariant(shop, token, v.id, variantCdnUrl, variantAltText);
                console.log(`[CSV→CDN] Variante ${variantKey} image ${variantImageFilename} attachée`);
              } catch (err) {
                console.error("Erreur attach image variante", handle, err);
              }
            }
          }
        }

        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.log("Erreur création produit GraphQL", handleUnique, err);
      }
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
