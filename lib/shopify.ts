export async function shopifyGraphQL(
  shop: string,
  token: string,
  query: string,
  variables: any = {}
) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`shopifyGraphQL failed: Non-JSON response (${res.status}) | Body: ${body}`);
  }
}

// supprime shopifyREST upload pour images
