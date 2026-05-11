const REFRESH_THEME_STORE_ID = 1567;

export async function findRefreshTheme({ shop, token }: { shop: string; token: string }) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
        query {
          themes(first: 20) {
            edges {
              node {
                id
                name
                role
                themeStoreId
              }
            }
          }
        }
      `,
    }),
  });

  const data = await res.json();
  const themes: Array<{ id: string; name: string; role: string; themeStoreId: number }> =
    data?.data?.themes?.edges?.map((e: any) => e.node) ?? [];

  // Prefer unpublished (draft) over published, in case merchant has multiple
  const match =
    themes.find((t) => t.themeStoreId === REFRESH_THEME_STORE_ID && t.role !== "main") ??
    themes.find((t) => t.themeStoreId === REFRESH_THEME_STORE_ID);

  if (!match) return null;

  // GID format: gid://shopify/OnlineStoreTheme/123456789
  const numericId = Number(match.id.split("/").pop());
  return { id: numericId, name: match.name, role: match.role };
}
