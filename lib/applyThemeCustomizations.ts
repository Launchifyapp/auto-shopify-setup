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

const API_VERSION = "2024-01";

async function verifyThemeExists({
  shop,
  token,
  themeId,
}: {
  shop: string;
  token: string;
  themeId: number;
}): Promise<void> {
  console.log(`[applyThemeCustomizations] Verifying theme ${themeId} on shop ${shop}`);
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes/${themeId}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const text = await res.text();
  console.log(`[applyThemeCustomizations] Theme verify response: ${res.status} ${text.substring(0, 200)}`);
  if (!res.ok) {
    throw new Error(`Theme ${themeId} not accessible via REST API: ${res.status} ${text}`);
  }
}

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
  const url = `https://${shop}/admin/api/${API_VERSION}/themes/${themeId}/assets.json`;
  const res = await fetch(url, {
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

  if (!res.ok) {
    const text = await res.text();
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
  await verifyThemeExists({ shop, token, themeId });

  const assets = lang === "en" ? ASSETS_EN : ASSETS_FR;
  for (const [key, value] of Object.entries(assets)) {
    console.log(`[applyThemeCustomizations] Uploading ${key}...`);
    await uploadAsset({ shop, token, themeId, key, value });
    console.log(`[applyThemeCustomizations] ✓ ${key}`);
  }
}
