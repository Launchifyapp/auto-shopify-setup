export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  try {
    const res = await fetch(`https://${shop}/admin/api/2023-07/pages.json`, {...});
    const data = await res.json();
    console.log("Résultat création page :", data);
    // Idem pour produits, collections...
  } catch (err) {
    console.error("Erreur setup Shopify :", err);
    throw err;
  }
}
