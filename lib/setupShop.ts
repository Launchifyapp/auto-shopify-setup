import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";

// ... (Toutes les fonctions utilitaires déjà dans ton script) ...

export async function setupShop({ session }: { session: Session }) {
  try {
    // ==== 0. UPLOAD LES 4 IMAGES GÉNÉRIQUES AVANT TOUT ====
    const genericImages = [
      "https://auto-shopify-setup.vercel.app/image1.jpg",
      "https://auto-shopify-setup.vercel.app/image2.jpg",
      "https://auto-shopify-setup.vercel.app/image3.jpg",
      "https://auto-shopify-setup.vercel.app/image4.webp"
    ];
    // Cet upload est "autonome" (pour la boutique, associée à rien)
    // Tu peux, par exemple, créer un produit "images-generiques" pour les héberger, ou juste les uploader si Shopify autorise un upload indépendant :
    // Ici, on montre un upload en produit factice :
    const genericProduct = {
      title: "Images Génériques",
      handle: "images-generiques-" + Math.random().toString(16).slice(2, 7),
      vendor: "auto",
      descriptionHtml: "Images génériques uploadées au démarrage",
    };
    let genericProductId: string | undefined;
    try {
      const productCreateData = await createProductWithSDK(session, genericProduct);
      genericProductId = productCreateData?.product?.id;
      if (genericProductId) {
        for (const img of genericImages) {
          await createProductMedia(session, genericProductId, img, "");
        }
        console.log("Images génériques uploadées sur le produit Images Génériques.");
      }
    } catch (err) {
      console.error("Erreur upload images générales:", err);
    }


    // 1. Créer la page Livraison
    const livraisonPageId = await createLivraisonPageWithSDK(session)
      || await getPageIdByHandle(session, "livraison");

    // 2. Récupérer la collection principale ("all")
    const mainCollectionId = await getAllProductsCollectionId(session);

    // 3. Récupérer id & titre du menu principal
    const mainMenuResult = await getMainMenuIdAndTitle(session);

    // 4. Chercher id de la page contact (handle="contact" dans Shopify)
    const contactPageId = await getPageIdByHandle(session, "contact");

    // 5. Mettre à jour le menu principal (avec resourceId ou url)
    if (mainMenuResult) {
      await updateMainMenu(
        session,
        mainMenuResult.id,
        mainMenuResult.title,
        livraisonPageId,
        mainCollectionId,
        contactPageId
      );
    } else {
      console.error("Main menu introuvable !");
    }

    // ... Reste du setup produit (inchangé ci-dessous) ...
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
            ...new Set(
              group
                .map((row) => (row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : ""))
                .filter((v) => !!v && v !== "Default Title")
            ),
          ].map((v) => ({ name: v }));
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
        const productCreateData = await createProductWithSDK(session, product);
        const productData = productCreateData?.product;
        const productId = productData?.id;
        if (!productId) {
          console.error(
            "Aucun productId généré.",
            JSON.stringify(productCreateData, null, 2)
          );
          continue;
        }
        console.log("Product créé avec id:", productId);

        // Upload images produit (hors variantes)
        const allImagesToAttach = [
          ...new Set([
            ...group.map((row) => row["Image Src"]).filter(Boolean),
          ]),
        ];
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          await createProductMedia(session, productId, normalizedUrl, "");
        }

        // Produit avec variantes (options)
        if (productOptionsOrUndefined && productOptionsOrUndefined.length > 0) {
          const seen = new Set<string>();
          const variants = group
            .map((row, idx) => {
              const optionValues: { name: string; optionName: string }[] = [];
              productOptions.forEach((opt, optIdx) => {
                const value =
                  row[`Option${optIdx + 1} Value`] &&
                  row[`Option${optIdx + 1} Value`].trim();
                if (value && value !== "Default Title") {
                  optionValues.push({ name: value, optionName: opt.name });
                }
              });
              const key = optionValues.map((ov) => ov.name).join("|");
              if (seen.has(key)) return undefined;
              seen.add(key);
              if (!optionValues.length) return undefined;

              const variant: any = {
                price: row["Variant Price"] || main["Variant Price"] || "0",
                optionValues,
              };
              if (row["Variant SKU"]) variant.sku = row["Variant SKU"];
              if (row["Variant Barcode"]) variant.barcode = row["Variant Barcode"];
              if (row["Variant Compare At Price"]) variant.compareAtPrice = row["Variant Compare At Price"];
              return variant;
            })
            .filter((v) => v && v.optionValues && v.optionValues.length);

          if (variants.length > 1) {
            await bulkCreateVariantsWithSDK(
              session,
              productId,
              variants.slice(1)
            );
          }

          const edges = productData?.variants?.edges;
          if (edges && edges.length) {
            const firstVariantId = edges[0].node.id;
            await updateDefaultVariantWithSDK(session, productId, firstVariantId, group[0]);
          }
        }

        const edges = productData?.variants?.edges;
        if (edges && edges.length) {
          for (const edge of edges) {
            const variantId = edge.node.id;
            const matchingRow = group.find(row =>
              edge.node.selectedOptions.every((opt: any) =>
                row[`Option${opt.index + 1} Value`] === opt.value
              )
            ) || group[0];
            const variantImageUrl = matchingRow["Variant Image"];
            if (variantImageUrl && variantImageUrl.trim() &&
                variantImageUrl !== "nan" && variantImageUrl !== "null" && variantImageUrl !== "undefined") {
              const normalizedUrl = normalizeImageUrl(variantImageUrl);
              const mediaId = await createProductMedia(session, productId, normalizedUrl, "");
              if (mediaId) {
                const ready = await waitForMediaReady(session, productId, mediaId, 20000);
                if (ready) {
                  await appendMediaToVariant(session, productId, variantId, mediaId);
                } else {
                  console.error("Media non READY après upload : pas de rattachement", mediaId);
                }
              }
            }
          }
        }
        await new Promise((res) => setTimeout(res, 300));
      } catch (err) {
        console.error("Erreur création produit GraphQL", handleUnique, err);
      }
    }
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
