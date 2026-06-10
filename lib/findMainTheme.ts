/**
 * Find the currently published (main) theme via GraphQL.
 * Returns { id: numericId, name, role } or null if not found.
 */
export async function findMainTheme({ shop, token }: { shop: string; token: string }) {
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
              }
            }
          }
        }
      `,
    }),
  });

  const data = await res.json();
  const themes: Array<{ id: string; name: string; role: string }> =
    data?.data?.themes?.edges?.map((e: any) => e.node) ?? [];

  console.log("[findMainTheme] Themes:", JSON.stringify(themes.map(t => ({ id: t.id, name: t.name, role: t.role }))));

  const main = themes.find((t) => t.role === "MAIN" || t.role === "main");
  if (!main) return null;

  const numericId = Number(main.id.split("/").pop());
  return { id: numericId, name: main.name, role: main.role };
}
