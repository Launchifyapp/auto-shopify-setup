import { parse } from 'csv-parse/sync';

export async function setupShop({ shop, token }: { shop: string; token: string }) {
  // 1. Upload images (batch)
  const mediaFiles = [
    { url: "https://auto-shopify-setup.vercel.app/image1.jpg", filename: "image1.jpg", mimeType: "image/jpeg" },
    { url: "https://auto-shopify-setup.vercel.app/image2.jpg", filename: "image2.jpg", mimeType: "image/jpeg" },
    { url: "https://auto-shopify-setup.vercel.app/image3.jpg", filename: "image3.jpg", mimeType: "image/jpeg" },
    { url: "https://auto-shopify-setup.vercel.app/image4.webp", filename: "image4.webp", mimeType: "image/webp" }
  ];
  await fetch("https://auto-shopify-setup.vercel.app/api/upload-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: mediaFiles })
  });

  // 2. Créer page Livraison
  await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      page: {
        title: "Livraison",
        body_html: `
          <p><b>Livraison GRATUITE</b></p>
          <p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition...</p>
        `.trim()
      }
    })
  });

  // 3. Créer page FAQ
  await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      page: { title: "FAQ", body_html: "<p>Crée ta FAQ ici</p>" }
    })
  });

  // 4. Collections
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

  // 5. Import produits CSV
  const csvUrl = "https://auto-shopify-setup.vercel.app/products.csv";
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: "," });
  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
    productsByHandle[row.Handle].push(row);
  }
  for (const [handle, group] of Object.entries(productsByHandle)) {
    const main = group[0];
    // ... (construit variants/options/images comme dans ton code existant)
    // ... (voir lib/setup.ts pour détail de ton code produit)
    // Puis crée le produit :
    const product: any = { /* comme avant */ };
    await fetch(`https://${shop}/admin/api/2023-07/products.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ product })
    });
  }
}
