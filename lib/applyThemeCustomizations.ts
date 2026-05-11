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

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 5000;

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
  value: object;
}) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}/assets.json`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        asset: {
          key,
          value: JSON.stringify(value),
        },
      }),
    });

    if (res.ok) return;

    const text = await res.text();

    // 404 means the theme is not fully ready yet — wait and retry
    if (res.status === 404 && attempt < MAX_RETRIES) {
      console.log(`[applyThemeCustomizations] Theme not ready (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    throw new Error(`Failed to upload asset ${key}: ${res.status} ${text}`);
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
  const assets = lang === "en" ? ASSETS_EN : ASSETS_FR;

  for (const [key, value] of Object.entries(assets)) {
    await uploadAsset({ shop, token, themeId, key, value });
  }
}
