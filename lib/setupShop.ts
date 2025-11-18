import fs from "fs";
import path from "path";
import { fetch } from "undici";
import { stagedUploadShopifyFile, pollShopifyFileCDNByFilename } from "./batchUploadUniversal";

// Détecte le séparateur CSV ; ou ,
function guessCsvDelimiter(csvText: string): ";" | "," {
  const firstLine = csvText.split("\n")[0];
  return firstLine.indexOf(";") >= 0 ? ";" : ",";
}

// Vérifie l'URL d'image
function validImageUrl(url?: string): boolean {
  if (!url) return false;
  const v = url.trim().toLowerCase();
  return !!v && v !== "nan" && v !== "null" && v !== "undefined";
}

// Pipeline principal d'installation Shopify
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: fetch CSV...");
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const delimiter = guessCsvDelimiter(csvText);
    console.log(`[Shopify] setupShop: detected delimiter=${delimiter}`);

    // Parse le CSV
    const records = csvText.split("\n").slice(1).map(line => {
      const fields = line.split(delimiter);
      // Adapte ici pour le format de ton CSV
      return {
        "Handle": fields[0],
        "Title": fields[1],
        "Vendor": fields[2],
        "Type": fields[3],
        "Tags": fields[4],
        "Body (HTML)": fields[5],
        "Image Src": fields[6],
        "Image Alt Text": fields[7],
        "Option1 Name": fields[8],
        "Option1 Value": fields[9],
        "Option2 Name": fields[10],
        "Option2 Value": fields[11],
        "Option3 Name": fields[12],
        "Option3 Value": fields[13],
        "Variant Image": fields[14]
      };
    });

    // Upload toutes les images (produits/variantes)
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
      // On télécharge d'abord l'image localement
      try {
        const imgBuffer = await fetch(img.url).then(res => res.arrayBuffer());
        const tempPath = path.join("/tmp", img.filename);
        fs.writeFileSync(tempPath, Buffer.from(imgBuffer));
        await stagedUploadShopifyFile(shop, token, tempPath);
      } catch (e) {
        console.error(`[setupShop BatchUpload FAIL] ${img.filename}:`, e);
      }
    }

    // Regroupe chaque handle avec toutes ses lignes CSV pour traitement produits
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    // Création produits + linkage images
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);
      const product: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
      };

      try {
        // GraphQL mutation création produit
        const gqlRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
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

        const gqlJson = await gqlRes.json() as any;
        const productData = gqlJson?.data?.productCreate?.product;
        const productId = productData?.id;
        if (!productId) {
          console.error(
            "Aucun productId généré.",
            "Réponse brute:", JSON.stringify(gqlJson)
          );
          continue;
        }

        // Link images de produit
        for (const row of group) {
          const productImageUrl = row["Image Src"];
          const imageAltText = row["Image Alt Text"] ?? "";
          if (validImageUrl(productImageUrl)) {
            try {
              const filename = productImageUrl.split('/').pop() ?? 'image.jpg';
              const cdnUrl: string | null = productImageUrl.startsWith("https://cdn.shopify.com")
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

        // Variants linkage pour images (optionnel, si tu as les données)
        const createdVariantsArr: any[] = productData?.variants?.edges?.map((edge: { node: any }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = (v.selectedOptions ?? []).map((opt: any) => opt.value).join(":");
          const matchingRows = group.filter(row =>
            [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
              .filter(Boolean).join(":") === variantKey
          );
          for (const variantCsvRow of matchingRows) {
            const variantImageUrl = variantCsvRow?.["Variant Image"];
            const variantAltText = variantCsvRow?.["Image Alt Text"] ?? "";
            if (v.id && validImageUrl(variantImageUrl)) {
              try {
                const filename = variantImageUrl.split('/').pop() ?? 'variant.jpg';
                const cdnUrl: string | null = variantImageUrl.startsWith("https://cdn.shopify.com")
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
    console.log("[Shopify] setupShop: DONE.");
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}

// Attach image to product (mutation GraphQL)
export async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
): Promise<any> {
  const res = await fetch(
    `https://${shop}/admin/api/2023-10/graphql.json`,
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
              preview { image { url } }
              mediaErrors { code message }
            }
            mediaUserErrors { code message }
          }
        }
        `,
        variables: { productId, media: [{
          originalSource: imageUrl,
          mediaContentType: "IMAGE",
          alt: altText,
        }] },
      }),
    }
  );
  const json = await res.json() as any;
  return json;
}

// Attach image to variant (mutation GraphQL)
export async function attachImageToVariant(
  shop: string,
  token: string,
  variantId: string,
  imageUrl: string,
  altText: string = ""
): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
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
  const json = await res.json() as any;
  return json;
}
