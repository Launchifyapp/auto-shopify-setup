import { parse } from 'csv-parse/sync';

// Fonction principale pour automatiser la boutique (SANS upload du thème)
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. UPLOAD images Shopify Files via API batch
    const mediaFiles = [
      { url: "https://auto-shopify-setup.vercel.app/image1.jpg", filename: "image1.jpg", mimeType: "image/jpeg" },
      { url: "https://auto-shopify-setup.vercel.app/image2.jpg", filename: "image2.jpg", mimeType: "image/jpeg" },
      { url: "https://auto-shopify-setup.vercel.app/image3.jpg", filename: "image3.jpg", mimeType: "image/jpeg" },
      { url: "https://auto-shopify-setup.vercel.app/image4.webp", filename: "image4.webp", mimeType: "image/webp" }
    ];
    try {
      const batchRes = await fetch("https://auto-shopify-setup.vercel.app/api/upload-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: mediaFiles })
      });
      const uploads = await batchRes.json();
      if (uploads.ok) {
        uploads.uploads.forEach((result: any, idx: number) => {
          if (result.ok) {
            console.log(`Upload réussi [${mediaFiles[idx].filename}] Shopify ID :`,
              result.result?.data?.fileCreate?.files?.[0]?.id);
          } else {
            console.log(`Erreur upload [${mediaFiles[idx].filename}]`, result.error || result.result);
          }
        });
      } else {
        console.log("Erreur batch upload", uploads.error);
      }
    } catch (err) {
      console.log("Erreur upload batch images Shopify:", err);
    }

    // 2. Création de la page Livraison
    const livraisonHtml = `
      <p><b>Livraison GRATUITE</b></p>
      <p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
      <ul>
        <li>France : 4-10 jours ouvrables</li>
        <li>Belgique: 4-10 jours ouvrables</li>
        <li>Suisse : 7-12 jours ouvrables</li>
        <li>Canada : 7-12 jours ouvrables</li>
        <li>Reste du monde : 7-14 jours</li>
      </ul>
    `.trim();

    await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        page: { title: "Livraison", body_html: livraisonHtml }
      })
    });

    // 3. Création de la page FAQ
    const faqHtml = `<p>Crée ta FAQ ici</p>`;
    await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        page: { title: "FAQ", body_html: faqHtml }
      })
    });

    // 4. Création des collections (Beauté & soins, Maison & confort)
    await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        smart_collection: {
          title: "Beauté & soins",
          rules: [{ column: "tag", relation: "equals", condition: "Beauté & soins" }]
        }
      })
    });

    await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        smart_collection: {
          title: "Maison & confort",
          rules: [{ column: "tag", relation: "equals", condition: "Maison & confort" }]
        }
      })
    });

    // 5. Import des produits CSV + variantes
    console.log('STEP: Import produits CSV');
    const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    console.log('CSV length:', csvText.length);

    try {
      const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });
      console.log('Nb produits à importer:', records.length);
      const productsByHandle: Record<string, any[]> = {};
      for (const row of records) {
        if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
        productsByHandle[row.Handle].push(row);
      }

      console.log('STEP: Création produits');
      for (const [handle, group] of Object.entries(productsByHandle)) {
        const main = group[0];
        const option1Values = group.map(row => row["Option1 Value"]?.trim()).filter(Boolean);
        const images = Array.from(new Set(
          group.map(row => row["Image Src"]).filter(src => src && src.length > 6)
        )).map((src, idx) => ({
          alt: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] || undefined,
          src,
        }));

        let variants: any[] = [];
        let options: any[] = [];

        if (
          [...new Set(option1Values)].length === 1 &&
          (option1Values[0] === "Default Title" || !option1Values[0])
        ) {
          variants = [{
            sku: main["Variant SKU"] || null,
            price: main["Variant Price"] || null,
            compareAtPrice: main["Variant Compare At Price"] || null,
            weight: main["Variant Grams"] ? Number(main["Variant Grams"]) : null,
            inventoryManagement: main["Variant Inventory Tracker"] || null,
            inventoryPolicy: main["Variant Inventory Policy"] || null,
            fulfillmentService: main["Variant Fulfillment Service"] || null,
            requiresShipping: main["Variant Requires Shipping"] === "true",
            taxable: main["Variant Taxable"] === "true",
            barcode: main["Variant Barcode"] || null,
            image: main["Variant Image"] || null,
            weightUnit: main["Variant Weight Unit"] || null
          }];
          options = [];
        } else {
          options = [];
          if (main["Option1 Name"]) options.push(main["Option1 Name"]);
          if (main["Option2 Name"]) options.push(main["Option2 Name"]);
          if (main["Option3 Name"]) options.push(main["Option3 Name"]);

          variants = group
            .filter(row => row["Option1 Value"] && row["Option1 Value"] !== "Default Title")
            .map(row => {
              return {
                sku: row["Variant SKU"] || null,
                price: row["Variant Price"] || main["Variant Price"] || null,
                compareAtPrice: row["Variant Compare At Price"] || null,
                weight: row["Variant Grams"] ? Number(row["Variant Grams"]) : null,
                inventoryManagement: row["Variant Inventory Tracker"] || null,
                inventoryPolicy: row["Variant Inventory Policy"] || null,
                fulfillmentService: row["Variant Fulfillment Service"] || null,
                requiresShipping: row["Variant Requires Shipping"] === "true",
                taxable: row["Variant Taxable"] === "true",
                barcode: row["Variant Barcode"] || null,
                image: row["Variant Image"] || null,
                weightUnit: row["Variant Weight Unit"] || null,
                options: [
                  row["Option1 Value"] || null,
                  row["Option2 Value"] || null,
                  row["Option3 Value"] || null
                ].filter(Boolean)
              };
            });
        }

        // Construction ProductInput (GraphQL)
        const productInput: any = {
          title: main.Title,
          bodyHtml: main["Body (HTML)"] || "",
          handle: handle,
          vendor: main.Vendor,
          productType: main.Type,
          tags: main.Tags,
          published: main.Published === "true",
          options,
          images: images.map(img => ({ altText: img.alt || img.src, src: img.src })),
          variants,
        };

        // Clean null/undefined for Shopify GraphQL
        Object.keys(productInput).forEach(
          k => (productInput[k] === null || productInput[k] === undefined) && delete productInput[k]
        );

        try {
          const gqlRes = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": token
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
              variables: { input: productInput }
            })
          });
          const gqlText = await gqlRes.text();
          console.log('Produit', handle, 'GraphQL status:', gqlRes.status, '| body:', gqlText);
        } catch (err) {
          console.log('Erreur création produit GraphQL', handle, err);
        }
        await new Promise(res => setTimeout(res, 300));
      }
    } catch (err) {
      console.log('Erreur parsing du CSV produits:', err);
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
