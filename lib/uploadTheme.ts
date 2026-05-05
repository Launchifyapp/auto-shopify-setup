import { Language, t } from "@/lib/i18n";

const THEME_STORE_ID = 1567;

export async function uploadTheme({ shop, token, lang = "fr" }: { shop: string; token: string; lang?: Language }) {
  const themeName = t(lang, "themeName");

  const themeUploadRes = await fetch(`https://${shop}/admin/api/2023-07/themes.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      theme: {
        name: themeName,
        theme_store_id: THEME_STORE_ID
      }
    })
  });
  const themeUploadData = await themeUploadRes.json();
  return themeUploadData?.theme?.id;
}
