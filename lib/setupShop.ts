import fs from "fs";
import path from "path";
import { fetch } from "undici";
import { stagedUploadShopifyFile, attachImageToProduct, attachImageToVariant } from "./batchUploadUniversal";

/**
 * Cette version lit directement products.json généré par shopify-csv-to-graphql-payload.js.
 * Elle utilise : productOptions et variants déjà patchés (structure et prix).
 */
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    console.log("[Shopify] setupShop: charger products.json...");
    // Assure-toi que products.json correspond au format patché
    const productsJSON = fs.readFileSync(path.resolve(process.cwd(), "products.json"), "utf8");
    const products: any[] = JSON.parse(productsJSON);

    let count = 0, errors: any[] = [];

    for (const { handle, title, descriptionHtml, vendor, productType, tags, productOptions, variants } of products) {
      let productId: string | undefined;
      try {
        // 1. Crée le produit avec productOptions (ne PAS mettre les variants ici !)
        const productCreateInput = {
          title,
          descriptionHtml,
          handle: handle + "-" + Math.random().toString(16).slice(2, 7),
          vendor,
          productType,
          tags,
          status: "ACTIVE",
          productOptions
        };

        const createRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product { id handle options { name values } variants(first: 2) { edges { node { id title sku selectedOptions { name value } } } } }
                  userErrors { field message }
                }
              }
            `,
            variables: { input: productCreateInput }
          }),
        });
        const createdJson: any = await createRes.json();
        productId = createdJson?.data?.productCreate?.product?.id;
        if (!productId) {
          errors.push({ handle, details: createdJson?.data?.productCreate?.userErrors ?? createdJson?.errors ?? "Unknown error" });
          console.error(`[${handle}] ERREUR productCreate`, JSON.stringify(createdJson?.data?.productCreate?.userErrors ?? createdJson?.errors, null, 2));
          continue;
        }
        count++;

        // PATCH : Suppression de la variante "Default Title" si existante
        const variantsDefault = createdJson?.data?.productCreate?.product?.variants?.edges ?? [];
        for (const v of variantsDefault) {
          if (v.node.title === "Default Title") {
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
                variables: { id: v.node.id }
              }),
            });
            console.log(`[${handle}] Default Title variant deleted`);
          }
        }

        // 2. Crée les variants en bulk (PAS via productCreate !)
        if (variants && variants.length > 0) {
          const bulkRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
            body: JSON.stringify({
              query: `
                mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantInput!]!) {
                  productVariantsBulkCreate(productId: $productId, variants: $variants) {
                    product {
                      id
                      variants(first: 20) {
                        edges { node { id sku title price selectedOptions { name value } } }
                      }
                    }
                    userErrors { field message }
                  }
                }
              `,
              variables: { productId, variants }
            }),
          });
          const bulkJson: any = await bulkRes.json();
          // Affiche les userErrors, utile pour la debug structure des variants
          if (bulkJson?.data?.productVariantsBulkCreate?.userErrors?.length) {
            errors.push({ handle, details: bulkJson?.data?.productVariantsBulkCreate?.userErrors });
            console.error(`[${handle}] ERREUR productVariantsBulkCreate`, JSON.stringify(bulkJson?.data?.productVariantsBulkCreate?.userErrors, null, 2));
          } else {
            const created = bulkJson?.data?.productVariantsBulkCreate?.product?.variants?.edges ?? [];
            console.log(`[${handle}] Variants créés Shopify:`, JSON.stringify(created, null, 2));
          }
        }

        // 3. Attacher les images du produit (ajoute la logique si tu veux utiliser tes sources CSV)
        // Tu peux utiliser stagedUploadShopifyFile et attachImageToProduct ici au besoin

        await new Promise(res => setTimeout(res, 100));
      } catch (err) {
        errors.push({ handle, details: err });
        console.error(`[${handle}] FATAL erreur setupShop pour le produit`, handle, err);
        continue;
      }
    }

    if (errors.length) {
      console.error("[Shopify] setupShop ERREURS produits :", JSON.stringify(errors, null, 2));
      throw new Error("Erreurs sur " + errors.length + " produits : " + JSON.stringify(errors, null, 2));
    }

    console.log(`[Shopify] setupShop: DONE. Products created: ${count}`);
    return { ok: true, created: count };
  } catch (err: any) {
    console.error("[Shopify] setupShop: FATAL ERROR", err);
    throw err;
  }
}
