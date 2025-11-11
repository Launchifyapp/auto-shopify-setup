export function getApiBase(shop?: string) {
  const s = shop || process.env.SHOPIFY_SHOP;
  const v = process.env.SHOPIFY_API_VERSION || "2025-10";
  if (!s) throw new Error("Missing shop domain");
  return { gql: `https://${s}/admin/api/${v}/graphql.json`, rest: `https://${s}/admin/api/${v}` };
}

export async function adminGraphQL<T = any>({
  shop, token, query, variables = {}
}: { shop?: string; token?: string; query: string; variables?: any; }) {
  const base = getApiBase(shop);
  const t = token || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!t) throw new Error("Missing Admin token");
  const res = await fetch(base.gql, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": t },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

export async function adminREST({
  shop, token, path, method = "GET", json
}: { shop?: string; token?: string; path: string; method?: string; json?: any; }) {
  const base = getApiBase(shop);
  const t = token || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!t) throw new Error("Missing Admin token");
  const res = await fetch(`${base.rest}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": t },
    body: json ? JSON.stringify(json) : undefined,
  });
  if (!res.ok) throw new Error(`REST ${method} ${path} failed: ${res.status}`);
  return res.json();
}
