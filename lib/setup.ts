export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  const livraisonHtml = `
    <p class="p1"><b>Livraison GRATUITE</b><b></b></p>
    <p class="p1">Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
    <ul class="ul1">
      <li class="li1">France : 4-10 jours ouvrables</li>
      <li class="li1">Belgique: 4-10 jours ouvrables</li>
      <li class="li1">Suisse : 7-12 jours ouvrables</li>
      <li class="li1">Canada : 7-12 jours ouvrables</li>
    </ul>
    <p class="p1">•&nbsp;&nbsp;•&nbsp;&nbsp;Reste du monde : 7-14 jours</p>
  `.trim();

  try {
    const res = await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {
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

    const data = await res.json();
    console.log("Résultat création page Livraison :", JSON.stringify(data));
    if (res.status >= 400) {
      throw new Error(`Erreur Shopify: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log("Erreur dans runFullSetup :", err);
    throw err;
  }
}
