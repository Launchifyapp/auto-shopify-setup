import { Language } from "@/lib/i18n";
import settingsDataFr from "@/lib/theme-assets/fr/settings_data.json";
import headerGroupFr from "@/lib/theme-assets/fr/header-group.json";
import footerGroupFr from "@/lib/theme-assets/fr/footer-group.json";
import indexFr from "@/lib/theme-assets/fr/index.json";
import productFr from "@/lib/theme-assets/fr/product.json";
import settingsDataEn from "@/lib/theme-assets/en/settings_data.json";
import headerGroupEn from "@/lib/theme-assets/en/header-group.json";
import footerGroupEn from "@/lib/theme-assets/en/footer-group.json";
import indexEn from "@/lib/theme-assets/en/index.json";
import productEn from "@/lib/theme-assets/en/product.json";

const ASSETS_FR: Record<string, object> = {
  "config/settings_data.json": settingsDataFr,
  "sections/header-group.json": headerGroupFr,
  "sections/footer-group.json": footerGroupFr,
  "templates/index.json": indexFr,
  "templates/product.json": productFr,
};

const ASSETS_EN: Record<string, object> = {
  "config/settings_data.json": settingsDataEn,
  "sections/header-group.json": headerGroupEn,
  "sections/footer-group.json": footerGroupEn,
  "templates/index.json": indexEn,
  "templates/product.json": productEn,
};

const GQL_ENDPOINT = (shop: string) => `https://${shop}/admin/api/2025-10/graphql.json`;

async function upsertThemeFile({
  shop,
  token,
  themeGid,
  filename,
  body,
}: {
  shop: string;
  token: string;
  themeGid: string;
  filename: string;
  body: string;
}) {
  const res = await fetch(GQL_ENDPOINT(shop), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `
        mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
          themeFilesUpsert(themeId: $themeId, files: $files) {
            upsertedThemeFiles { filename }
            userErrors { filename field message }
          }
        }
      `,
      variables: {
        themeId: themeGid,
        files: [{ filename, body: { type: "TEXT", value: body } }],
      },
    }),
  });

  const data = await res.json();
  console.log(`[applyThemeCustomizations] upsert ${filename}:`, JSON.stringify(data).substring(0, 300));

  if (data?.errors) {
    throw new Error(`GraphQL request error for ${filename}: ${JSON.stringify(data.errors)}`);
  }
  const userErrors = data?.data?.themeFilesUpsert?.userErrors;
  if (userErrors?.length) {
    throw new Error(`GraphQL error for ${filename}: ${JSON.stringify(userErrors)}`);
  }
}

export async function applyThemeCustomizations({
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
  console.log(`[applyThemeCustomizations] shop=${shop} themeId=${themeId} tokenPrefix=${token.substring(0, 8)}`);

  // Check which scopes the token actually has
  const scopeRes = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: `{ app { installation { accessScopes { handle } } } }` }),
  });
  const scopeData = await scopeRes.json();
  const scopes: string[] = scopeData?.data?.app?.installation?.accessScopes?.map((s: any) => s.handle) ?? [];
  console.log(`[applyThemeCustomizations] Token scopes:`, scopes.join(", ") || "(none returned)");
  if (!scopes.includes("write_themes")) {
    throw new Error("Token missing write_themes scope. The merchant may need to reinstall the app to grant the updated permissions.");
  }

  const themeGid = `gid://shopify/OnlineStoreTheme/${themeId}`;
  const assets = lang === "en" ? ASSETS_EN : ASSETS_FR;

  for (const [filename, value] of Object.entries(assets)) {
    await upsertThemeFile({
      shop,
      token,
      themeGid,
      filename,
      body: JSON.stringify(value),
    });
  }
}
