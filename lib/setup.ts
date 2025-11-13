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

    // 4. Upload produits CSV + variantes (patch multi-images/mono-variant)
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
      const main = group[0];

      // Check all Option1 Values
      const option1Values = group.map(row => row["Option1 Value"]?.trim()).filter(Boolean);

      // Images : toutes uniques du groupe pour le produit
      const images = Array.from(new Set(
        group
          .map(row => row["Image Src"])
          .filter(src => src && src.length > 6)))
        .map((src, idx) => ({
          src,
          position: idx + 1,
          alt: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] || undefined
        }));

      let variants: any[] = [];
      let options: any[] = [];

      // Si toutes les Option1Value sont "Default Title" (ou vide), c'est un produit sans variantes mais possiblement avec plusieurs lignes d'images
      if (
        [...new Set(option1Values)].length === 1 &&
        (option1Values[0] === "Default Title" || !option1Values[0])
      ) {
        // Produit mono-variant !
        variants = [{
          sku: main["Variant SKU"] || undefined,
          price: main["Variant Price"] || undefined,
          compare_at_price: main["Variant Compare At Price"] || undefined,
          grams: main["Variant Grams"] || undefined,
          inventory_management: main["Variant Inventory Tracker"] || undefined,
          inventory_policy: main["Variant Inventory Policy"] || undefined,
          fulfillment_service: main["Variant Fulfillment Service"] || undefined,
          requires_shipping: main["Variant Requires Shipping"] || undefined,
          taxable: main["Variant Taxable"] || undefined,
          barcode: main["Variant Barcode"] || undefined,
          image: main["Variant Image"] || undefined,
          weight_unit: main["Variant Weight Unit"] || undefined
        }];
        options = []; // PAS d'option Shopify sur produit mono-variant !
      } else {
        // Produit AVEC variantes (donc plusieurs Option1Value différentes)
        options = [];
        if (main["Option1 Name"]) options.push({ name: main["Option1 Name"] });
        if (main["Option2 Name"]) options.push({ name: main["Option2 Name"] });
        if (main["Option3 Name"]) options.push({ name: main["Option3 Name"] });

        variants = group
          .filter(row => row["Option1 Value"] && row["Option1 Value"] !== "Default Title")
          .map(row => {
            let v: { [key: string]: any } = {
              option1: row["Option1 Value"],
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
      }

      // Compose le product JSON
      const product: any = {
        title: main.Title,
        body_html: main["Body (HTML)"],
        handle: handle,
        vendor: main.Vendor,
        product_type: main.Type,
        tags: main.Tags,
        published: main.Published === "true",
        variants,
        images
      };
      if (options.length > 0) product.options = options;

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

    // 5. Upload DU THÈME ZIP + publication (comme avant)
    console.log("Upload thème...");
    const themeZipUrl = "https://auto-shopify-setup.vercel.app/DREAMIFY.zip";
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
