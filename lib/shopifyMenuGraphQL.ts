import { shopifyGraphQL } from "./yourGraphQLHelper"; // ou copie la fonction shopifyGraphQL plus haut

export async function getAllCollectionGID(shop: string, token: string): Promise<string | undefined> {
  const query = `
    query {
      collections(first: 10, query: "handle:all") {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const result = await shopifyGraphQL(shop, token, query);
  const allCollection = result.data.collections.edges.find(
    (edge: any) => edge.node.handle === "all"
  );
  return allCollection ? allCollection.node.id : undefined;
}

export async function getPageGID(shop: string, token: string, pageTitleOrHandle: string): Promise<string | undefined> {
  const query = `
    query {
      pages(first: 20) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  `;
  const result = await shopifyGraphQL(shop, token, query);
  const page = result.data.pages.edges.find(
    (edge: any) =>
      edge.node.title.toLowerCase() === pageTitleOrHandle.toLowerCase() ||
      edge.node.handle === pageTitleOrHandle
  );
  return page ? page.node.id : undefined;
}

// -- Utilisation dans ton setup --
// const allCollectionGID = await getAllCollectionGID(shop, token);
// const livraisonGID = await getPageGID(shop, token, "Livraison");
// const faqGID = await getPageGID(shop, token, "FAQ");
// const contactGID = await getPageGID(shop, token, "Contact");

// Passe ensuite ces GID dans updateMainMenu !
