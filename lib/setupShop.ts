import { parse } from "csv-parse/sync";

// Fonction principale pour l'import produits Shopify via GraphQL API 2025-10 (création, variantes, médias)
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Charger le CSV produits
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });

    // Regrouper les lignes par handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];

      // 1️⃣ Créer le produit avec la mutation productCreate (sans variantes/images)
      const option1Name = main["Option1 Name"];
      const option1Values = group.map(row => row["Option1 Value"]?.trim()).filter(Boolean);

      // Préparer productOptions si elles existent
      const productOptions = option1Name
        ? [{
            name: option1Name,
            values: [...new Set(option1Values)].map(v => ({ name: v }))
          }]
        : undefined;

      // Générer un handle unique pour éviter l'erreur "already in use"
      const handleUnique =
        handle + "-" + Math.random().toString(16).slice(2, 7);

      // Construction de l'objet conforme ProductCreateInput
      const product: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle: handleUnique,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
        productOptions,
      };

      try {
        // 🟢 Mutation productCreate
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
                  product { id title handle options { id name position optionValues { id name hasVariants } } }
                  userErrors { field message }
                }
              }
            `,
            variables: { product },
          }),
        });
        const gqlJson = await gqlRes.json();
        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));
        const productId = gqlJson?.data?.productCreate?.product?.id;
        if (!productId) {
          console.warn("Aucun productId généré, erreur:", gqlJson?.data?.productCreate?.userErrors);
          continue;
        }

        // 2️⃣ Ajout des variantes en bulk (productVariantsBulkCreate)
        const variants = group
          .filter(row => row["Option1 Value"] && row["Option1 Value"] !== "Default Title")
          .map(row => ({
            sku: row["Variant SKU"] || undefined,
            price: row["Variant Price"] || main["Variant Price"] || undefined,
            compareAtPrice: row["Variant Compare At Price"] || undefined,
            requiresShipping: row["Variant Requires Shipping"] === "true",
            taxable: row["Variant Taxable"] === "true",
            fulfillmentService: row["Variant Fulfillment Service"] || undefined,
            inventoryPolicy: (row["Variant Inventory Policy"] || "DENY").toUpperCase(),
            weight: row["Variant Grams"] ? Number(row["Variant Grams"]) : undefined,
            weightUnit: (row["Variant Weight Unit"] || "KILOGRAMS").toUpperCase(),
            barcode: row["Variant Barcode"] || undefined,
            selectedOptions: option1Name
              ? [{ name: option1Name, value: row["Option1 Value"] }]
              : [],
          }));

        // 🟢 Mutation productVariantsBulkCreate
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
                      productVariants { id sku price selectedOptions { name value } }
                      userErrors { field message }
                    }
                  }
                `,
                variables: { productId, variants },
              }),
            });
            const bulkJson = await bulkRes.json();
            console.log('Bulk variants response:', JSON.stringify(bulkJson, null, 2));
          } catch (err) {
            console.log('Erreur bulk variants GraphQL', handleUnique, err);
          }
        }

        // 3️⃣ Ajout des images via productCreateMedia
        const images = Array.from(new Set(
          group.map(row => row["Image Src"])
            .filter(src => typeof src === "string" && src.length > 6)
        )).map(src => ({
          alt: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] ?? "",
          originalSource: src,
        }));

        // 🟢 Mutation productCreateMedia
        if (images.length) {
          try {
            const mediaRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": token,
              },
              body: JSON.stringify({
                query: `
                  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
                    productCreateMedia(productId: $productId, media: $media) {
                      media { id alt }
                      userErrors { field message }
                    }
                  }
                `,
                variables: { productId, media: images },
              }),
            });
            const mediaJson = await mediaRes.json();
            console.log('Media created', handleUnique, '| GraphQL response:', JSON.stringify(mediaJson, null, 2));
          } catch (err) {
            console.log('Erreur création media GraphQL', handleUnique, err);
          }
        }
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
