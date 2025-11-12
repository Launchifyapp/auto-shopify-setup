import { parse } from "csv-parse/sync";
import { updateMainMenu } from "./shopifyMenuGraphQL";

// Ce code est pour Next.js/Node !
// Adapte selon ton backend si tu utilises un runtime spécial.

export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  // 1. Créer la page Livraison
  const livraisonHtml = `
<p class="p1"><b>Livraison GRATUITE</b><b></b></p>
<p class="p1">Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
<ul class="ul1">
<li class="li1">France : 4-10 jours ouvrables</li>
<li class="li1">Belgique: 4-10 jours ouvrables</li>
<li class="li1">Suisse : 7-12 jours ouvrables</li>
<li class="li1">Canada : 7-12 jours ouvrables</li>
<li class="li1">Reste du monde : 7-14 jours</li>
</ul>
  `.trim();

  // 2. Créer la page FAQ
  const faqHtml = `<p>Crée ta FAQ ici</p>`;

  try {
    // ----- PAGE LIVRAISON -----
    await fetch(`https://${shop}/admin/api/2024-01/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        page: {
          title: "Livraison",
          body_html: livraisonHtml
        }
      })
    });

    // ----- PAGE FAQ -----
    await fetch(`https://${shop}/admin/api/2024-01/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        page: {
          title: "FAQ",
          body_html: faqHtml
        }
      })
    });

    // ----- SMART COLLECTIONS "Beauté & soins" et "Maison & confort" -----
    await Promise.all([
      fetch(`https://${shop}/admin/api/2024-01/smart_collections.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token
        },
        body: JSON.stringify({
          smart_collection: {
            title: "Beauté & soins",
            rules: [
              { column: "tag", relation: "equals", condition: "Beauté & soins" }
            ]
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
            rules: [
              { column: "tag", relation: "equals", condition: "Maison & confort" }
            ]
          }
        })
      })
    ]);

    // ---------- AUTOMATISATION MENU PRINCIPAL (GraphQL) ----------
    await updateMainMenu(shop, token);

    // ----- UPLOAD PRODUITS (CSV) -----
    // const csvUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/products.csv";
    // const response = await fetch(csvUrl);
    // const csvText = await response.text();
    // const records = parse(csvText, { columns: true, skip_empty_lines: true });
    // for (const row of records) {
    //   await fetch(`https://${shop}/admin/api/2023-07/products.json`, {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //       "X-Shopify-Access-Token": token
    //     },
    //     body: JSON.stringify({ product: row })
    //   });
    // }

    // ----- UPLOAD THEME ZIP et publication -----
    // const themeZipUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/DREAMIFY.V2.-.FR.zip";
    // await fetch(`https://${shop}/admin/api/2023-07/themes.json`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "X-Shopify-Access-Token": token
    //   },
    //   body: JSON.stringify({
    //     theme: {
    //       name: "Dreamify V2",
    //       src: themeZipUrl
    //     }
    //   })
    // });
    // // Pour publier: faire un PUT sur /themes/{id}.json avec { "theme": { "role": "main" } }

    // ----- UPLOAD IMAGES .JPG -----
    // Pour uploader des images, pointer vers l'API produits ou assets
    // Exemple:
    // await fetch(`https://${shop}/admin/api/2023-07/products/${productId}/images.json`, { ... });

  } catch (err) {
    console.log("Erreur dans runFullSetup :", err);
    throw err;
  }
}
