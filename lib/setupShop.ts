import { parse } from "csv-parse/sync";
import { writeFileSync } from "fs";
import path from "path";

// ... Chemin local où tu veux écrire le mapping (change si besoin)
const PRODUCT_MAPPING_PATH = "./productHandleToId.json";
const VARIANT_MAPPING_PATH = "./variantKeyToId.json";

// Mappings utilisés entre scripts
const productHandleToId: Record<string, string> = {};
const variantKeyToId: Record<string, string> = {};

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });

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
        sku?: string;
        title?: string;
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

      // On conserve le handle unique pour mapping
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
        // Enregistre le mapping handle → productId 
        productHandleToId[handle] = productId;

        console.log('Produit créé', handleUnique, '| GraphQL response:', JSON.stringify(gqlJson, null, 2));

        // Récupère les variants créés initialement
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        const createdVariantsCount = createdVariantsArr.length;

        // Mapping variante pour upload images (clé = handle + valeurs d'options)
        for (const v of createdVariantsArr) {
          // Génère la clé, exemple : "t-shirt:rouge:M"
          const variantKey =
            handle + ":" +
            (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          if (v.id) {
            variantKeyToId[variantKey] = v.id;
          }
        }

        // Calcul du nombre de variants attendus
        const expectedVariantsCount = group.filter(row =>
          productOptions.some((opt, idx) =>
            row[`Option${idx + 1} Value`] && row[`Option${idx + 1} Value`].trim() !== "Default Title"
          )
        ).length;

        // Bulk create si variants manquants
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
              // Ajoute les nouveaux variants au mapping
              if (bulkJson.data?.productVariantsBulkCreate?.productVariants) {
                for (const v of bulkJson.data.productVariantsBulkCreate.productVariants) {
                  // Impossible de deviner les options, on ignore ici mais tu peux compléter via une requête de lecture si essentiel
                }
              }
            } catch (err) {
              console.log('Erreur bulk variants GraphQL', handleUnique, err);
            }
          }
        }
        // timeout anti-throttle Shopify : 300ms
        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
    }
    // On écrit le mapping produit/variant pour traitement batch images
    writeFileSync(PRODUCT_MAPPING_PATH, JSON.stringify(productHandleToId, null, 2));
    writeFileSync(VARIANT_MAPPING_PATH, JSON.stringify(variantKeyToId, null, 2));
    console.log("📦 Mapping produits enregistré:", PRODUCT_MAPPING_PATH);
    console.log("📦 Mapping variantes enregistré:", VARIANT_MAPPING_PATH);
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
