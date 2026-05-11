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

const GQL_ENDPOINT = (shop: string) =>
  `https://${shop}/admin/api/2025-10/graphql.json`;

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
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
        mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
          themeFilesUpsert(themeId: $themeId, files: $files) {
            upsertedThemeFiles {
              filename
            }
            userErrors {
              filename
              field
              message
            }
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

  const userErrors = data?.data?.themeFilesUpsert?.userErrors;
  if (userErrors?.length) {
    throw new Error(`GraphQL error for ${filename}: ${JSON.stringify(userErrors)}`);
  }
  if (data?.errors) {
    throw new Error(`GraphQL request error for ${filename}: ${JSON.stringify(data.errors)}`);
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
  const themeGid = `gid://shopify/OnlineStoreTheme/${themeId}`;
  console.log(`[applyThemeCustomizations] Applying customizations via GraphQL. shop=${shop} themeGid=${themeGid}`);

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
