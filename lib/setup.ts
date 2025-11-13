import { parse } from "csv-parse/sync";

export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  try {
    // 1. Créer la page Livraison
    console.log('STEP: Livraison');
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
    const res1 = await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ page: { title: "Livraison", body_html: livraisonHtml } })
    });
    console.log('Livraison status:', res1.status, 'body:', await res1.text());

    // 2. Créer la page FAQ
    console.log('STEP: FAQ');
    const faqHtml = `<p>Crée ta FAQ ici</p>`;
    const res2 = await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ page: { title: "FAQ", body_html: faqHtml } })
    });
    console.log('FAQ status:', res2.status, 'body:', await res2.text());

    // 3. Créer les collections
    console.log('STEP: Collection 1');
    const res3 = await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ smart_collection: { title: "Beauté & soins", rules: [{ column: "tag", relation: "equals", condition: "Beauté & soins" }]}})
    });
    console.log('Collection 1 status:', res3.status, 'body:', await res3.text());

    console.log('STEP: Collection 2');
    const res4 = await fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ smart_collection: { title: "Maison & confort", rules: [{ column: "tag", relation: "equals", condition: "Maison & confort" }]}})
    });
    console.log('Collection 2 status:', res4.status, 'body:', await res4.text());

    // 4. Import produits CSV + variantes
    console.log('STEP: Import produits CSV');
    const csvUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true });
    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    console.log('STEP: Création produits');
    let compteur = 0;
    for (const [handle, group] of Object.entries(productsByHandle)) {
      const main = group[0];
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
      await new Promise(res => setTimeout(res, 300));
      if (++compteur > 10) break; // Pour debug, stop après 10 produits
    }

    // 5. Upload DU THÈME ZIP + publication (avec polling)
    console.log('STEP: Upload thème');
    const themeZipUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/DREAMIFY-V2.zip";
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
    const themeTxt = await themeUploadRes.text();
    console.log('Thème upload status:', themeUploadRes.status, '| body:', themeTxt);

    let themeId;
    try {
      const themeUploadData = JSON.parse(themeTxt);
      themeId = themeUploadData?.theme?.id;
    } catch (e) {
      console.log('Erreur parsing theme JSON', e);
    }

    // Polling publication
    if (themeId) {
      console.log('STEP: Polling publication thème');
      let statusOk = false, tries = 0;
      while (!statusOk && tries < 20) {
        await new Promise(res => setTimeout(res, 2000));
        tries++;
        const resTheme = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
          headers: { "X-Shopify-Access-Token": token }
        });
        const pollTxt = await resTheme.text();
        console.log(`Theme poll ${tries} status:`, resTheme.status, '| body:', pollTxt);
        let themeDetail;
        try {
          themeDetail = JSON.parse(pollTxt);
        } catch (e) { continue; }
        if (themeDetail?.theme?.role === "unpublished" && themeDetail?.theme?.processing === false) {
          statusOk = true;
        }
      }
      if (statusOk) {
        console.log('STEP: Publication du thème');
        const themePutRes = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token
          },
          body: JSON.stringify({ theme: { role: "main" } })
        });
        const themePutTxt = await themePutRes.text();
        console.log('Theme publish status:', themePutRes.status, '| body:', themePutTxt);
      }
    } else {
      console.log('Aucun themeId uploadé, skip publication');
    }

    console.log('SETUP FINI !');
  } catch (err) {
    console.log("Erreur globale runFullSetup:", err);
  }
}
