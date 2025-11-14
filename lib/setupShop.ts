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
        body: JSON.stringify({ images: mediaFiles }),
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
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        page: { title: "Livraison", body_html: livraisonHtml },
      }),
    });

    // 3. Création de la page FAQ
    const faqHtml = `<p>Crée ta FAQ ici</p>`;
    await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        page: { title: "FAQ", body_html: faqHtml },
      }),
    });

    // 4. Création des collections
    const collections = [
      { title: "Beauté & soins", tag: "Beauté & soins" },
      { title: "Maison & confort", tag: "Maison & confort" },
    ];
    for (const col of collections) {
      await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          smart_collection: {
            title: col.title,
            rules: [{ column: "tag", relation: "equals", condition: col.tag }],
          },
        }),
      });
    }

    // 5. Importation des produits CSV + variantes en GraphQL
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
          altText: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] || undefined,
        }));

        // Préparation des options (version GraphQL)
        let optionValues = [];
        if (main["Option1 Name"]) optionValues.push(...group.map(row => row["Option1 Value"]).filter(v => v));
        let options: any[] = [];
        if (main["Option1 Name"]) options.push({ name: main["Option1 Name"], values: [...new Set(optionValues)] });

        // Préparation des variantes (version GraphQL)
        const variantObjects = group.map(row => ({
          price: row["Variant Price"] || main["Variant Price"] || undefined,
          compareAtPrice: row["Variant Compare At Price"] || undefined,
          selectedOptions: main["Option1 Name"] ? [{ name: main["Option1 Name"], value: row["Option1 Value"] }] : [],
          requiresShipping: row["Variant Requires Shipping"] === "true",
          taxable: row["Variant Taxable"] === "true",
          fulfillmentService: row["Variant Fulfillment Service"] || undefined,
          inventoryPolicy: (row["Variant Inventory Policy"] || "deny").toUpperCase(),
          weight: row["Variant Grams"] ? Number(row["Variant Grams"]) : undefined,
          weightUnit: (row["Variant Weight Unit"] || "KILOGRAMS").toUpperCase(),
          sku: row["Variant SKU"] || undefined,
          barcode: row["Variant Barcode"] || undefined,
          image: row["Variant Image"] ? { src: row["Variant Image"], altText: "" } : undefined,
        }));

        // Construction de l'objet ProductInput pour Shopify Admin GraphQL
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
          variants: variantObjects.length ? variantObjects : undefined,
        };

        // Clean keys null/undefined
        Object.keys(productInput).forEach(
          k => (productInput[k] === null || productInput[k] === undefined) && delete productInput[k]
        );

        // Envoi mutation GraphQL
        try {
          const gqlRes = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
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
      console.log('Erreur parsing du CSV produits:', err);
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
