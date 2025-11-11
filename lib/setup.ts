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
          body_html: "<p>Crée ta FAQ ici</p>"
        }
      })
    });

    // ----- SMART COLLECTIONS Beauté & soins + Maison & confort -----
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
    // Shopify navigation API: menus = "links" sur la resource "navigation"
    // Le menu principal est "main-menu" (ou "main menu" en anglais)
    // On récupère les ID, puis on PATCH le menu :
    // Note : la nouvelle API "menus" est encore en beta (https://shopify.dev/docs/api/admin-rest/2023-10/resources/navigation)
    // On fait avec REST classique :
    await fetch(`https://${shop}/admin/api/2023-07/links.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        link: {
          title: "Accueil",
          type: "frontpage",
          position: 1
        }
      })
    });
    await fetch(`https://${shop}/admin/api/2023-07/links.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        link: {
          title: "Nos produits",
          type: "collection",
          position: 2
        }
      })
    });
    await fetch(`https://${shop}/admin/api/2023-07/links.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        link: {
          title: "Livraison",
          type: "page",
          position: 3
        }
      })
    });
    await fetch(`https://${shop}/admin/api/2023-07/links.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        link: {
          title: "FAQ",
          type: "page",
          position: 4
        }
      })
    });
    await fetch(`https://${shop}/admin/api/2023-07/links.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        link: {
          title: "Contact",
          type: "page",
          position: 5
        }
      })
    });

    // ----- UPLOAD PRODUITS (depuis CSV DREAMIFY.V2.-.FR.zip) -----
    // Shopify ne permet pas l'upload CSV via l'API REST standard (mais via bulk API GraphQL ou admin import tool)
    // Ici on donne la méthode classique (besoin d'un parser CSV côté Node ou Next.js pour lire et POST les produits un à un)
    // Pour le zip, tu dois extraire le CSV et parser chaque ligne :
    /* Exemple simplifié (sans extraction ZIP) :
    const csvUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/products.csv";
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    // Utilise 'csv-parse' ou autre lib pour parser
    const records = parse(csvText, { columns: true, skip_empty_lines: true });
    for (const row of records) {
      await fetch(`https://${shop}/admin/api/2023-07/products.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token
        },
        body: JSON.stringify({ product: {/* mappe les champs ici */} })
      });
    }
    */

    // ----- UPLOAD THEME ZIP et publication -----
    // Shopify REST API: /admin/api/2023-07/themes.json
    // Upload d'un thème distant : on télécharge le ZIP, puis on POST vers Shopify
    // (Shopify supporte upload direct depuis URL avec certains apps/scripts)
    /*
    const themeZipUrl = "https://github.com/Launchifyapp/auto-shopify-setup/releases/download/V1/DREAMIFY.V2.-.FR.zip";
    await fetch(`https://${shop}/admin/api/2023-07/themes.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        theme: {
          name: "Dreamify V2",
          src: themeZipUrl // si supporté par l'API (sinon upload fichier code via asset API)
        }
      })
    });
    // Pour publier le thème, il faut utiliser l'ID renvoyé et faire un PUT sur /themes/{id}.json
    */

    // ----- UPLOAD IMAGES .JPG -----
    // Pour uploader des images: il faut les associer à des produits (product images), ou comme asset du thème via les APIs appropriées.
    // Exemple d'upload d'image produit :
    /*
    await fetch(`https://${shop}/admin/api/2023-07/products/${productId}/images.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        image: {
          src: "https://url/de/ton/image.jpg"
        }
      })
    });
    */
  } catch (err) {
    console.log("Erreur dans runFullSetup :", err);
    throw err;
  }
}
