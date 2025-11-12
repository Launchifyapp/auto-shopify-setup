// Utilitaires génériques pour parler à l’API Shopify (REST et GraphQL)

export async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {}
) {
  const res = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

export async function shopifyREST(
  shop: string,
  token: string,
  endpoint: string,
  method: string = "GET",
  body?: any
) {
  const res = await fetch(`https://${shop}/admin/api/2023-07/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}
