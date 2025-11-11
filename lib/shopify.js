export async function shopifyAdminFetch<T>(
  shop: string,
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `https://${shop}/admin/api/2024-10${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function shopifyGraphQL<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}
