import { parse } from "csv-parse/sync";

// --- Utilities ---
function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

// Extraction des metafields "checkbox" du CSV, au format attendu par Shopify
function extractCheckboxMetafields(row: any): any[] {
  const metafields: any[] = [];
  if (row["Checkbox 1 (product.metafields.custom.checkbox_1)"] !== undefined)
    metafields.push({
      namespace: "custom",
      key: "checkbox_1",
      type: "single_line_text_field",
      value: row["Checkbox 1 (product.metafields.custom.checkbox_1)"].toString()
    });
  if (row["Checkbox 2 (product.metafields.custom.checkbox_2)"] !== undefined)
    metafields.push({
      namespace: "custom",
      key: "checkbox_2",
      type: "single_line_text_field",
      value: row["Checkbox 2 (product.metafields.custom.checkbox_2)"].toString()
    });
  if (row["Checkbox 3 (product.metafields.custom.checkbox_3)"] !== undefined)
    metafields.push({
      namespace: "custom",
      key: "checkbox_3",
      type: "single_line_text_field",
      value: row["Checkbox 3 (product.metafields.custom.checkbox_3)"].toString()
    });
  return metafields;
}

// Upload image en media produit Shopify
async function attachImageToProduct(
  shop: string,
  token: string,
  productId: string,
  imageUrl: string,
  altText: string = ""
): Promise<string | undefined> {
  const media = [{
    originalSource: imageUrl,
    mediaContentType: "IMAGE",
    alt: altText
  }];
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              ... on MediaImage { id image { url } }
            }
            mediaUserErrors { field message }
          }
        }
      `,
      variables: { productId, media }
    })
  });
  const json = await res.json();
  return json?.data?.productCreateMedia?.media?.[0]?.id;
}

// Upload "Files" à la boutique Shopify (non lié à un produit)
async function uploadShopFile(shop: string, token: string, fileUrl: string, alt: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              createdAt
              id
              alt
              url
            }
            userErrors { field message }
          }
        }
      `,
      variables: {
        files: [
          {
            alt,
            originalSource: fileUrl,
          }
        ]
      }
    })
  });
  const json = await res.json();
  return json?.data?.fileCreate?.files?.[0];
}

// Création bulk des variantes (si > 1 variant)
async function bulkCreateVariants(shop: string, token: string, productId: string, variants: any[]) {
  if (!productId || !variants?.length) return;
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id sku price compareAtPrice }
            userErrors { field message }
          }
        }
      `,
      variables: { productId, variants },
    }),
  });
  return await res.json();
}

// PATCH: Met à jour le prix et compareAtPrice d'une variante existante
async function updateVariantPrice(
  shop: string,
  token: string,
  variantId: string,
  price: string,
  compareAtPrice?: string
) {
  if (!variantId || price == undefined) return;
  const variables: any = { id: variantId, price };
  if (compareAtPrice !== undefined) {
    variables.compareAtPrice = compareAtPrice;
  }
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation productVariantUpdate($id: ID!, $price: Money!, $compareAtPrice: Money) {
          productVariantUpdate(id: $id, price: $price, compareAtPrice: $compareAtPrice) {
            productVariant { id price compareAtPrice }
            userErrors { field message }
          }
        }
      `,
      variables,
    }),
  });
  return await res.json();
}

// Crée la page Livraison
async function createLivraisonPage(shop: string, token: string) {
  const pageTitle = "Livraison";
  const pageContent = `
<h1>Livraison GRATUITE</h1>
<p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
<ul>
  <li>France : 4-10 jours ouvrables</li>
  <li>Belgique: 4-10 jours ouvrables</li>
  <li>Suisse : 7-12 jours ouvrables</li>
  <li>Canada : 7-12 jours ouvrables</li>
  <li>Reste du monde : 7-14 jours</li>
</ul>
  `;

  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation pageCreate($input: PageInput!) {
          pageCreate(input: $input) {
            page { id handle title }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: { title: pageTitle, bodyHtml: pageContent }
      }
    })
  });
  const json = await res.json();
  return json?.data?.pageCreate?.page?.id;
}

// Fonction principale
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Upload des images dans Shopify Files (une fois, non liées à des produits)
    // Adapte le domaine à ton vrai publicBaseUrl si différent
    const publicBaseUrl = "https://auto-shopify-setup.vercel.app";
    const publicImages = [
      { url: `${publicBaseUrl}/image1.jpg`, alt: "Image 1" },
      { url: `${publicBaseUrl}/image2.jpg`, alt: "Image 2" },
      { url: `${publicBaseUrl}/image3.jpg`, alt: "Image 3" },
      { url: `${publicBaseUrl}/image4.webp`, alt: "Image 4" }
    ];
    for (const img of publicImages) {
      await uploadShopFile(shop, token, img.url, img.alt);
    }

    // 2. Crée la page Livraison
    await createLivraisonPage(shop, token);

    // 3. Import produits et variantes (ta logique précédente inchangée)
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      type ProductOption = { name: string, values: { name: string }[] };
      const productOptions: ProductOption[] = [];
      for (let i = 1; i <= 3; i++) {
        const optionName = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
        if (optionName) {
          const optionValues = [
            ...new Set(group.map(row => row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : "")
              .filter(v => !!v && v !== "Default Title"))
          ].map(v => ({ name: v }));
          if (optionValues.length) {
            productOptions.push({ name: optionName, values: optionValues });
          }
        }
      }
      const productOptionsOrUndefined = productOptions.length ? productOptions : undefined;
      const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);

      const productMetafields = extractCheckboxMetafields(main);

      const product: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
        productOptions: productOptionsOrUndefined,
        metafields: productMetafields.length > 0 ? productMetafields : undefined,
      };

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
                    handle
                    variants(first: 50) {
                      edges { node { id sku title selectedOptions { name value } } }
                    }
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
        if (!productId) {
          console.error("Aucun productId généré.", JSON.stringify(gqlJson, null, 2));
          continue;
        }

        // Upload des images CSV liées au produit
        const allImagesToAttach = [
          ...new Set([
            ...group.map(row => row["Image Src"]).filter(Boolean),
            ...group.map(row => row["Variant Image"]).filter(Boolean),
          ])
        ];
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          await attachImageToProduct(shop, token, productId, normalizedUrl, "");
        }

        // Création des variantes
        const seen = new Set<string>();
        const variants = group
          .map(row => {
            const optionValues: { name: string; optionName: string }[] = [];
            productOptions.forEach((opt, idx) => {
              const value = row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim();
              if (value && value !== "Default Title") {
                optionValues.push({ name: value, optionName: opt.name });
              }
            });
            const key = optionValues.map(ov => ov.name).join('|');
            if (seen.has(key)) return undefined;
            seen.add(key);
            if (!optionValues.length && group.length === 1) {
              return {
                price: row["Variant Price"] || main["Variant Price"] || "0",
                compareAtPrice: row["Variant Compare At Price"] || undefined,
                sku: row["Variant SKU"] || undefined,
                barcode: row["Variant Barcode"] || undefined,
                optionValues: []
              };
            }
            if (!optionValues.length) return undefined;
            return {
              price: row["Variant Price"] || main["Variant Price"] || "0",
              compareAtPrice: row["Variant Compare At Price"] || undefined,
              sku: row["Variant SKU"] || undefined,
              barcode: row["Variant Barcode"] || undefined,
              optionValues
            };
          })
          .filter(v => v);

        if (variants.length > 1) {
          // Supprime la variante "Default Title"
          const defaultVariantId = productData?.variants?.edges?.[0]?.node?.id;
          if (defaultVariantId) {
            await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
              body: JSON.stringify({
                query: `
                  mutation productVariantDelete($id: ID!) {
                    productVariantDelete(id: $id) {
                      deletedProductVariantId
                      userErrors { field message }
                    }
                  }
                `,
                variables: { id: defaultVariantId }
              }),
            });
          }
          await bulkCreateVariants(shop, token, productId, variants);

        } else if (variants.length === 1) {
          const defaultVariantId = productData?.variants?.edges?.[0]?.node?.id;
          if (
            defaultVariantId &&
            typeof variants[0]?.price !== "undefined"
          ) {
            await updateVariantPrice(
              shop,
              token,
              defaultVariantId,
              variants[0].price,
              variants[0].compareAtPrice
            );
          }
        }

        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.error('Erreur création produit GraphQL', handleUnique, err);
      }
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
