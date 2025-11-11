export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  // Test: création page "Livraison"
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
          body_html: "<p>Test automatisation Vercel</p>"
        }
      })
    });

    const data = await res.json();
    console.log("Résultat création page Livraison :", JSON.stringify(data));
    // Gestion explicite d'erreur
    if (res.status >= 400) {
      throw new Error(`Erreur Shopify: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log("Erreur dans runFullSetup :", err);
    throw err;
  }
}
