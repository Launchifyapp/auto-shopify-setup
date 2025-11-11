export async function adminGraphQL<T = any>({
  shop,
  token,
  query,
  variables
}: {
  shop: string;
  token: string;
  query: string;
  variables?: Record<string, any>;
}): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/2023-01/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  return await res.json();
}

export async function adminREST({
  shop,
  token,
  path,
  method,
  json
}: {
  shop: string;
  token: string;
  path: string;
  method: string;
  json?: Record<string, any>;
}): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2023-01${path}`, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: json ? JSON.stringify(json) : undefined
  });
  return await res.json();
}
