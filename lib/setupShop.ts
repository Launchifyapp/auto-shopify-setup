import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";

// Fonction pour créer la page Livraison via Shopify API
async function createLivraisonPageWithSDK(session: Session) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation CreatePage($input: PageCreateInput!) {
      pageCreate(page: $input) {
        page {
          id
          title
          handle
        }
        userErrors { code field message }
      }
    }
  `;
  const variables = { input: {
    title: "Livraison",
    handle: "livraison",
    body: `Livraison GRATUITE
Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:

France : 4-10 jours ouvrables
Belgique: 4-10 jours ouvrables
Suisse : 7-12 jours ouvrables
Canada : 7-12 jours ouvrables
Reste du monde : 7-14 jours
`,
    isPublished: true,
    templateSuffix: "custom"
  }};

  // PATCH correct : variables doivent être passées dans un objet { variables: ... }
  const response: any = await client.request(query, { variables });
  const data = response;
  if (data?.data?.pageCreate?.userErrors?.length) {
    console.error("Erreur création page Livraison:", data.data.pageCreate.userErrors);
  } else {
    console.log("Page Livraison créée :", data.data.pageCreate.page);
  }
}
