import { parse } from "csv-parse/sync";

export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  try {

    // 2. Créer la page Livraison
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

    // 3. Créer la page FAQ
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

    // 4. Créer les collections
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

    // 4. Import produits CSV + variantes
console.log('STEP: Import produits CSV');
const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv"; // adapte ici l'URL !
const response = await fetch(csvUrl);
const csvText = await response.text();
console.log('CSV length:', csvText.length); // log pour debug

try {
  const records = parse(csvText, { columns: true, skip_empty_lines: true });
  console.log('Nb produits à importer:', records.length);
  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
    productsByHandle[row.Handle].push(row);
  }

  console.log('STEP: Création produits');
  let compteur = 0;
  for (const [handle, group] of Object.entries(productsByHandle)) {
    const main = group[0];

    // Options/variants/images
    const option1Values = group.map(row => row["Option1 Value"]?.trim()).filter(Boolean);
    const images = Array.from(new Set(
      group.map(row => row["Image Src"]).filter(src => src && src.length > 6)
    )).map((src, idx) => ({
      src,
      position: idx + 1,
      alt: group.find(row => row["Image Src"] === src)?.["Image Alt Text"] || undefined
    }));

    let variants: any[] = [];
    let options: any[] = [];

    if (
      [...new Set(option1Values)].length === 1 &&
      (option1Values[0] === "Default Title" || !option1Values[0])
    ) {
      // Mono-variant (pas d'options)
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
      options = [];
    } else {
      // Produit avec variantes (option1/option2/option3)
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

    // Création du JSON produit Shopify
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

    // REQUEST API SHOPIFY
    try {
      const prodRes = await fetch(`https://${shop}/admin/api/2023-07/products.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token
        },
        body: JSON.stringify({ product })
      });
      const prodTxt = await prodRes.text();
      console.log('Produit', handle, 'status:', prodRes.status, '| body:', prodTxt);
    } catch (err) {
      console.log('Erreur produit', handle, err);
    }
    await new Promise(res => setTimeout(res, 300)); // anti-rate-limit
    // Pour debug, stop après 10 produits
    if (++compteur > 10) break;
  }
} catch (err) {
  console.log('Erreur parsing du CSV produits:', err);
}

    // 6. Upload DU THÈME ZIP + publication (avec polling)
    const themeZipUrl = "https://github.com/Launchifyapp/auto-shopify-setup/blob/main/public/DREAMIFY-V2.zip";
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

    if (themeUploadData?.theme?.id) {
      const themeId = themeUploadData.theme.id;
      let statusOk = false, tries = 0;
      while (!statusOk && tries < 20) {
        await new Promise(res => setTimeout(res, 2000));
        tries++;
        const resTheme = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
          headers: { "X-Shopify-Access-Token": token }
        });
        const themeDetail = await resTheme.json();
        if (themeDetail?.theme?.role === "unpublished" && themeDetail?.theme?.processing === false) {
          statusOk = true;
        }
      }
      if (statusOk) {
        await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
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
      }
    }
    // Fin global
  } catch (err) {
    // catch globale si besoin
  }
}
