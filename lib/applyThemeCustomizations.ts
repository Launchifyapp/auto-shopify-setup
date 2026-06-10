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

async function uploadAsset({
  shop,
  token,
  themeId,
  key,
  value,
}: {
  shop: string;
  token: string;
  themeId: number;
  key: string;
  value: string;
}) {
  const url = `https://${shop}/admin/api/2023-07/themes/${themeId}/assets.json`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ asset: { key, value } }),
  });

  const text = await res.text();
  console.log(`[applyThemeCustomizations] PUT ${key}: status=${res.status}`);

  if (!res.ok) {
    throw new Error(`Failed to upload ${key}: ${res.status} ${text.substring(0, 200)}`);
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
  console.log(`[applyThemeCustomizations] shop=${shop} themeId=${themeId} lang=${lang}`);

  const assets = lang === "en" ? ASSETS_EN : ASSETS_FR;

  for (const [key, value] of Object.entries(assets)) {
    await uploadAsset({ shop, token, themeId, key, value: JSON.stringify(value) });
  }
}
