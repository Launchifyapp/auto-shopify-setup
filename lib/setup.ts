import { parse } from "csv-parse/sync";
import _ from "lodash";

export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  // ----- 1. Créer la page Livraison -----
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

  const faqHtml = `<p>Crée ta FAQ ici</p>`;

  // Création des pages
  try {
    // Livraison
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

    // FAQ
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
  } catch (err) {
    console.log("Erreur création pages :", err);
  }

  // ----- 2. Créer les collections -----
  try {
    await Promise.all([
      fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
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
      }),
      fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
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
      })
    ]);
  } catch (err) {
    console.log("Erreur création smart collections :", err);
  }

  // ----- 3. Upload Produits avec Variantes depuis le CSV -----
  try {
    const csvUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true });
    const productsByHandle = _.groupBy(records, row => row.Handle);

    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];
      const options = [];
      if (main["Option1 Name"]) options.push({ name: main["Option1 Name"] });
      if (main["Option2 Name"]) options.push({ name: main["Option2 Name"] });
      if (main["Option3 Name"]) options.push({ name: main["Option3 Name"] });

      const variants = group.map(row => {
        const v = {
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
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k]);
        return v;
      });

      const images = Array.from(new Set(
        group.map(row => row["Image Src"]).filter(src => src)
      )).map((src, idx) => ({
        src,
        position: idx + 1,
        alt: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] || undefined
      }));

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
        if (data.errors) {
          console.log("Erreur produit:", handle, data.errors);
        } else {
          console.log("Produit créé:", handle, data.product?.id);
        }
      } catch (err) {
        console.log("Erreur Network produit:", handle, err);
      }
      await new Promise(res => setTimeout(res, 250));
    }
  } catch (err) {
    console.log("Erreur upload produits CSV:", err);
  }

  // ----- 4. Upload du thème ZIP et publication -----
  try {
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

    if (themeUploadData && themeUploadData.theme && themeUploadData.theme.id) {
      await fetch(`https://${shop}/admin/api/2023-07/themes/${themeUploadData.theme.id}.json`, {
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
      });
      console.log("Thème publié:", themeUploadData.theme.id);
    } else {
      console.log("Échec upload thème", themeUploadData?.errors || themeUploadData);
    }
  } catch (err) {
    console.log("Erreur upload/publish thème:", err);
  }
}
