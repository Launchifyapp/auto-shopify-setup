import { parse } from "csv-parse/sync";

export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Créer la page Livraison
    console.log("Création page Livraison...");
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

    const livraisonResp = await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
     method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        page: { title: "Livraison", body_html: livraisonHtml }
      })
    });
    console.log("Réponse API page Livraison:", await livraisonResp.json());

    // 2. Créer la page FAQ
    console.log("Création page FAQ...");
    const faqHtml = `<p>Crée ta FAQ ici</p>`;
    const faqResp = await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        page: { title: "FAQ", body_html: faqHtml }
      })
    });
    console.log("Réponse API page FAQ:", await faqResp.json());

    // 3. Créer les collections
    console.log("Création des collections...");
    const collection1 = await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
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
    console.log("Réponse API collection Beauté & soins:", await collection1.json());

    const collection2 = await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
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
    console.log("Réponse API collection Maison & confort:", await collection2.json());

    // 4. Upload produits CSV + variantes (sans lodash)
    console.log("Import produits CSV...");
    const csvUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true });

    // GROUP BY HANDLE (native JS)
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
      console.log("Création produit:", handle);

      // Options dynamiques
      const main = group[0];
      const options = [];
      if (main["Option1 Name"]) options.push({ name: main["Option1 Name"] });
      if (main["Option2 Name"]) options.push({ name: main["Option2 Name"] });
      if (main["Option3 Name"]) options.push({ name: main["Option3 Name"] });

      // Variantes
      const variants = group.map(row => {
        let v: { [key: string]: any } = {
          option1: row["Option1 Value"] || "Default Title",
          option2: row["Option2 Value"] || undefined,
          option3: row["Option3 Value"] || undefined,
          sku: row["Variant SKU"] || undefined,
          price: row["Variant Price"] || main["Variant Price"] || undefined,
          compare_at_price: row["Variant Compare At Price"] || undefined,
          grams: row["Variant Grams"] || undefined,
          inventory_management: row["Variant Inventory Tracker"] || undefined,
          inventory_policy: row["Variant Inventory Policy"] || undefined,
          fulfillment_service: row["Variant Fulfillment Service"] || undefined,
          requires_shipping: row["Variant Requires Shipping"] || undefined,
          taxable: row["Variant Taxable"] || undefined,
          barcode: row["Variant Barcode"] || undefined,
          image: row["Variant Image"] || undefined,
          weight_unit: row["Variant Weight Unit"] || undefined
        };
        Object.keys(v).forEach(k => { if (v[k] === undefined) delete v[k]; });
        return v;
      });

      // Images (uniques, avec alt)
      const imagesSet = new Set();
      const images: Array<{src:string, position:number, alt?:string}> = [];
      group.forEach((row) => {
        if (row["Image Src"] && !imagesSet.has(row["Image Src"])) {
          imagesSet.add(row["Image Src"]);
          images.push({
            src: row["Image Src"],
            position: imagesSet.size,
            alt: row["Image Alt Text"] || undefined
          });
        }
      });

      const product = {
        title: main.Title,
        body_html: main["Body (HTML)"],
        handle: handle,
        vendor: main.Vendor,
        product_type: main.Type,
        tags: main.Tags,
        published: main.Published === "true",
        options: options,
        variants: variants,
        images: images
      };

      try {
        const res = await fetch(`https://${shop}/admin/api/2023-07/products.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token
          },
          body: JSON.stringify({ product })
        });
        const data = await res.json();
        console.log("Réponse Shopify product:", handle, JSON.stringify(data));
      } catch (err) {
        console.log("Erreur sur le produit :", handle, err);
      }
      await new Promise(res => setTimeout(res, 300)); // anti-rate-limit
    }

    // 5. Upload du thème ZIP + publication
    console.log("Upload thème...");
    const themeZipUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/DREAMIFY.V2.-.FR.zip";
    const themeUploadRes = await fetch(`https://${shop}/admin/api/2023-07/themes.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        theme: {
          name: "Dreamify V2 FR",
          src: themeZipUrl
        }
      })
    });
    const themeUploadData = await themeUploadRes.json();
    console.log("Réponse Shopify thème (upload):", JSON.stringify(themeUploadData));

    if (themeUploadData && themeUploadData.theme && themeUploadData.theme.id) {
      const themePublishRes = await fetch(
        `https://${shop}/admin/api/2023-07/themes/${themeUploadData.theme.id}.json`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token
          },
          body: JSON.stringify({
            theme: {
              role: "main"
            }
          })
        }
      );
      const publishThemeData = await themePublishRes.json();
      console.log("Réponse Shopify thème (publish):", JSON.stringify(publishThemeData));
      console.log("Thème publié :", themeUploadData.theme.id);
    } else {
      console.log("Échec upload thème", themeUploadData?.errors || themeUploadData);
    }
    console.log("SETUP FINI !");
  } catch (err) {
    console.log("Erreur globale runFullSetup:", err);
  }
}
