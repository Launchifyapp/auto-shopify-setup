export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  // Création de la page "Livraison"
  try {
    const createPageRes = await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        page: {
          title: "Livraison",
          body_html: "<p>Informations sur la livraison...</p>"
        }
      })
    });

    const pageData = await createPageRes.json();
    // Tu peux logguer le résultat en développement
    console.log("Résultat création page Livraison :", pageData);

    // Ajoute ici les autres étapes : création de FAQ, collections, produits, menu, thème, etc.
    // Chaque étape doit suivre le même modèle : fetch() avec l'API REST Shopify, le bon endpoint, le token en header !

  } catch (err) {
    // Pour repropager vers le catch global, lance l'erreur
    throw err;
  }
}
