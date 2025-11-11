// Utilitaires minimes pour appeler l'Admin API Shopify (REST + GraphQL)

export async function shopifyAdminFetch(shop, accessToken, path, init = {}) {
  const url = `https://${shop}/admin/api/2024-10${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export async function shopifyGraphQL(shop, accessToken, query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL $
