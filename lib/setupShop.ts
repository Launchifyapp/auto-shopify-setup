import { parse } from 'csv-parse/sync';

// Fonction principale pour automatiser la boutique avec Shopify GraphQL productCreate
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Fetch du CSV produits
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });

    // Regroupe les lignes CSV par handle produit
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];
      const option1Name = main["Option1 Name"];
      const option1Values = group.map(row => row["Option1 Value"]?.trim()).filter(Boolean);
      const options: { name: string, values: string[] }[] = option1Name
        ? [{ name: option1Name, values: [...new Set(option1Values)] }]
        : [];

      // Images au format ProductImageInput (GraphQL)
      const images = Array.from(new Set(
        group.map(row => row["Image Src"])
          .filter(src => typeof src === "string" && src.length > 6)
      )).map(src => ({
        src,
        altText: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] ?? "",
      }));

      // Variantes au format ProductVariantInput (GraphQL)
      const variants = group.map(row => ({
        price: row["Variant Price"] || main["Variant Price"] || undefined,
        compareAtPrice: row["Variant Compare At Price"] || undefined,
        selectedOptions: option1Name
          ? [{ name: option1Name, value: row["Option1 Value"] }]
          : [],
        requiresShipping: row["Variant Requires Shipping"] === "true",
        taxable: row["Variant Taxable"] === "true",
        fulfillmentService: row["Variant Fulfillment Service"] || undefined,
        inventoryPolicy: (row["Variant Inventory Policy"] || "DENY").toUpperCase(),
        weight: row["Variant Grams"] ? Number(row["Variant Grams"]) : undefined,
        weightUnit: (row["Variant Weight Unit"] || "KILOGRAMS").toUpperCase(),
        sku: row["Variant SKU"] || undefined,
        barcode: row["Variant Barcode"] || undefined,
        image: row["Variant Image"]
          ? { src: row["Variant Image"], altText: "" }
          : undefined,
      }));

      // Construction ProductInput conforme GraphQL
      const productInput: any = {
        title: main.Title,
        descriptionHtml: main["Body (HTML)"] || "",
        handle,
        vendor: main.Vendor,
        productType: main.Type,
        tags: main.Tags?.split(",").map((t: string) => t.trim()),
        published: main.Published === "true",
        options: options.length ? options : undefined,
        images: images.length ? images : undefined,
        variants: variants.length ? variants : undefined,
      };

      // Supprime les clés null/undefined
      Object.keys(productInput).forEach(
        k => (productInput[k] === null || productInput[k] === undefined) && delete productInput[k]
      );

      try {
        const gqlRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product { id title }
                  userErrors { field message }
                }
              }
            `,
            variables: { input: productInput },
          }),
        });
        const gqlJson = await gqlRes.json();
        console.log('Produit', handle, 'GraphQL status:', gqlRes.status, '| response:', JSON.stringify(gqlJson, null, 2));
      } catch (err) {
        console.log('Erreur création produit GraphQL', handle, err);
      }
      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
