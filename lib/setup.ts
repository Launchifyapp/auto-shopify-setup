import { parse } from "csv-parse/sync";

// Ce code est pour Next.js/Node !
// Ajoute ou adapte selon ton backend si tu utilises un runtime special.

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
    await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
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
    await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
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
      fetch(`https://${shop}/admin/api/2023-07/smart_collections.json`, {
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

    // ----- MODIFIER MENU PRINCIPAL -----
    // Shopify REST API n'offre pas la modification directe du main-menu: il faut d'abord récupérer l'ID du menu et PATCH ses liens. 
    // Ici, voici la logique à adapter en fonction de ton shop (vérifie l'ID ou modifie via l'admin API ou theme json si besoin).
    // Pour la démo, on ajoute des liens classiques (voir doc Shopify Navigation API).
    const menuLinks = [
      { title: "Accueil", type: "frontpage" },
      { title: "Nos produits", type: "collection" },
      { title: "Livraison", type: "page" },
      { title: "FAQ", type: "page" },
      { title: "Contact", type: "page" }
    ];
    for (let i = 0; i < menuLinks.length; i++) {
      await fetch(`https://${shop}/admin/api/2023-07/links.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token
        },
        body: JSON.stringify({
          link: {
            title: menuLinks[i].title,
            type: menuLinks[i].type,
            position: i + 1
          }
        })
      });
    }

    // ----- UPLOAD PRODUITS (CSV) -----
    // Voici un squelette à compléter: (conversion CSV > création de produits)
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
    //     body: JSON.stringify({ product: row }) // Mapper explicitement les champs Shopify ici !
    //   });
    // }

    // ----- UPLOAD THEME ZIP et publication -----
    // Voir doc https://shopify.dev/docs/api/admin-rest/2023-07/resources/theme#[post]/admin/api/2023-07/themes.json
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
    //       src: themeZipUrl // Peut nécessiter un workflow particulier côté Shopify ou app partner
    //     }
    //   })
    // });
    // Pour publier: faire un PUT sur /themes/{id}.json avec { "theme": { "role": "main" } }

    // ----- UPLOAD IMAGES .JPG -----
    // Pour uploader des images, pointer vers l'API produits ou assets, en utilisant les bonnes URLs ou buffers binaires.
    // Ex :
    // await fetch(`https://${shop}/admin/api/2023-07/products/${productId}/images.json`, { ... });

  } catch (err) {
    console.log("Erreur dans runFullSetup :", err);
    throw err;
  }
}
