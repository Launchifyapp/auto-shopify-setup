// Script à utiliser dans Node.js/Next.js ou à inclure dans ton provisioning backend
// "shop" = le nom de la boutique (ex: "monshop.myshopify.com")
// "token" = le token d'API Shopify avec accès admin

export async function setupMainMenu(shop: string, token: string) {
  // 1. Récupérer le menu principal (handle "main-menu")
  const getMenuRes = await fetch(`https://${shop}/admin/api/2023-07/linklists.json`, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    }
  });
  const menuData = await getMenuRes.json();
  const mainMenu = menuData.linklists.find((menu: any) => menu.handle === "main-menu");

  // 2. Préparer la structure des liens souhaitée
  const newLinks = [
    { title: "Accueil", type: "frontpage", position: 1 },
    { title: "Nos produits", type: "collection", position: 2, subject_id: null }, // optionnel: associer à la collection "all" ou autre selon besoin
    { title: "Livraison", type: "page", position: 3, subject_id: null },
    { title: "FAQ", type: "page", position: 4, subject_id: null },
    { title: "Contact", type: "page", position: 5, subject_id: null }
  ];

  // 3. Mettre à jour le menu principal
  if (mainMenu) {
    // PATCH avec les nouveaux liens (remplace toutes les entrées)
    await fetch(`https://${shop}/admin/api/2023-07/linklists/${mainMenu.id}.json`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        linklist: {
          links: newLinks
        }
      })
    });
    console.log("Menu principal mis à jour avec succès !");
  } else {
    // Sinon, création du menu main-menu
    await fetch(`https://${shop}/admin/api/2023-07/linklists.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        linklist: {
          handle: "main-menu",
          title: "Menu principal",
          links: newLinks
        }
      })
    });
    console.log("Menu principal créé !");
  }
}
