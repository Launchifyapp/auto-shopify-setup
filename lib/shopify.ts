/**
 * Fonctions utilitaires pour automatiser la configuration Shopify (menu principal, etc.)
 *
 * Usage :
 *   import { setupMainMenu } from "./shopify";
 *   await setupMainMenu(shop, token);
 */

export async function setupMainMenu(shop: string, token: string): Promise<void> {
  // Récupère le menu principal ("main-menu") via l'API REST Shopify
  const getMenuRes = await fetch(`https://${shop}/admin/api/2023-07/linklists.json`, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    }
  });

  if (!getMenuRes.ok) {
    throw new Error("Impossible de récupérer la liste des menus Shopify.");
  }

  const menuData = await getMenuRes.json();
  const mainMenu = menuData.linklists.find((menu: any) => menu.handle === "main-menu");

  // Structure des liens à injecter dans le menu principal
  const newLinks = [
    { title: "Accueil", type: "frontpage", position: 1 },
    { title: "Nos produits", type: "collection", position: 2 }, // peut être lié à une collection précise si besoin
    { title: "Livraison", type: "page", position: 3 },
    { title: "FAQ", type: "page", position: 4 },
    { title: "Contact", type: "page", position: 5 }
  ];

  if (mainMenu) {
    // Met à jour le menu principal existant
    const updateRes = await fetch(`https://${shop}/admin/api/2023-07/linklists/${mainMenu.id}.json`, {
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

    if (!updateRes.ok) {
      throw new Error("Impossible de mettre à jour le menu principal Shopify.");
    }
    console.log("Menu principal mis à jour avec succès !");
  } else {
    // Crée le menu principal si absent
    const createRes = await fetch(`https://${shop}/admin/api/2023-07/linklists.json`, {
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

    if (!createRes.ok) {
      throw new Error("Impossible de créer le menu principal Shopify.");
    }
    console.log("Menu principal créé !");
  }
}
