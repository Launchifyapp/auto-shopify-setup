import { parse } from 'csv-parse/sync';

// Fonction principale pour automatiser la boutique (SANS upload du thème)
export async function setupShop({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Upload des fichiers médias via API batch
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
            console.log(`Upload réussi [${mediaFiles[idx].filename}] Shopify ID :`, result.result?.data?.fileCreate?.files?.[0]?.id);
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
        <li>Belgique : 4-10 jours ouvrables</li>
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
    const collections = [
      { title: "Beauté & soins", tag: "Beauté & soins" },
      { title: "Maison & confort", tag: "Maison & confort" }
    ];

    for (const col of collections) {
      await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token
        },
        body: JSON.stringify({
          smart_collection: {
            title: col.title,
            rules: [{ column: "tag", relation: "equals", condition: col.tag }]
          }
        })
      });
    }

    // 5. Import des produits CSV + variantes (mutation GraphQL)
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
        )).map(src => ({
          src,
          alt: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] || undefined,
        }));

        // Gestion des options et variantes
        let variantObjects: any[] = [];
        let options: any[] = [];

        // Options
        if (main["Option1 Name"]) options.push({ name: main["Option1 Name"] });
        if (main["Option2 Name"]) options.push({ name: main["Option2 Name"] });
        if (main["Option3 Name"]) options.push({ name: main["Option3 Name"] });

        // Variants
        variantObjects = group
          .map(row => {
            return {
              option1: row["Option1 Value"] || undefined,
              option2: row["Option2 Value"] || undefined,
              option3: row["Option3 Value"] || undefined,
              sku: row["Variant SKU"] || undefined,
              price: row["Variant Price"] || main["Variant Price"] || undefined,
              compare_at_price: row["Variant Compare At Price"] || undefined,
              grams: row["Variant Grams"] ? Number(row["Variant Grams"]) : undefined,
              inventory_management: row["Variant Inventory Tracker"] || undefined,
              inventory_policy: row["Variant Inventory Policy"] || undefined,
              fulfillment_service: row["Variant Fulfillment Service"] || undefined,
              requires_shipping: row["Variant Requires Shipping"] === "true",
              taxable: row["Variant Taxable"] === "true",
              barcode: row["Variant Barcode"] || undefined,
              image: row["Variant Image"] || undefined,
              weight_unit: row["Variant Weight Unit"] || undefined
            };
          });

        // Construction des datas Produit pour GraphQL (conformité Shopify)
        const productInput: any = {
          title: main.Title,
          body_html: main["Body (HTML)"] || "",
          handle: handle,
          vendor: main.Vendor,
          product_type: main.Type,
          tags: main.Tags,
          published: main.Published === "true",
          options: options.length ? options : undefined,
          images: images.length ? images : undefined,
          variants: variantObjects.length ? variantObjects : undefined,
        };

        // Nettoyage des champs vides/undefined
        Object.keys(productInput).forEach(
          k => (productInput[k] === undefined || productInput[k] === null) && delete productInput[k]
        );

        // Envoi mutation GraphQL productCreate
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
          const gqlJson = await gqlRes.json();
          console.log('Produit', handle, 'GraphQL status:', gqlRes.status, '| response:', JSON.stringify(gqlJson, null, 2));
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
