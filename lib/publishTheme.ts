import { Language } from "@/lib/i18n";
import { applyThemeCustomizations } from "@/lib/applyThemeCustomizations";

const GQL_ENDPOINT = (shop: string) => `https://${shop}/admin/api/2025-10/graphql.json`;

export async function publishTheme({
  shop,
  token,
  themeId,
  lang = "fr",
}: {
  shop: string;
  token: string;
  themeId: number;
  lang?: Language;
}) {
  // Apply theme file customizations first
  await applyThemeCustomizations({ shop, token, themeId, lang });

  // Publish the theme via GraphQL themePublish mutation
  const themeGid = `gid://shopify/OnlineStoreTheme/${themeId}`;
  const res = await fetch(GQL_ENDPOINT(shop), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation PublishTheme($id: ID!) {
          themePublish(id: $id) {
            theme {
              id
              name
              role
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: { id: themeGid },
    }),
  });

  const data = await res.json();
  console.log(`[publishTheme] themePublish response:`, JSON.stringify(data).substring(0, 400));

  if (data?.errors) {
    throw new Error(`GraphQL error publishing theme: ${JSON.stringify(data.errors)}`);
  }
  const userErrors = data?.data?.themePublish?.userErrors;
  if (userErrors?.length) {
    throw new Error(`Theme publish error: ${JSON.stringify(userErrors)}`);
  }

  return { ok: true };
}
