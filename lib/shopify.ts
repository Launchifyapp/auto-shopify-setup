export const gqlAdmin = (shop: string, token: string) => async <T>(query: string, variables?: any): Promise<T> => {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') || 1);
    await new Promise(r => setTimeout(r, retry * 1000));
    return gqlAdmin(shop, token)<T>(query, variables);
  }
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
};
