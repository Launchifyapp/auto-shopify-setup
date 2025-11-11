// /lib/shopify.js
// Utilitaires REST et GraphQL (Admin API)

async function shopifyAdminFetch(shop, accessToken, path, init) {
  const url = `https://${shop}/admin/api/2024-10${path}`;
  const res = await fetch(url, {
    ...(init || {}),
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...((init && init.headers) || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function shopifyGraphQL(shop, accessToken, query, variables) {
  const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify GraphQL ${res.status} ${res.statusText}: ${text}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

module.exports = {
  shopifyAdminFetch,
  shopifyGraphQL,
};
