import { Language, t } from "@/lib/i18n";

export async function uploadTheme({ shop, token, lang = "fr" }: { shop: string; token: string; lang?: Language }) {
  // Select theme URL based on language
  // Note: For English, once theme-en.zip is added to public/, it will be used
  const themeZipUrl = lang === "en" 
    ? "https://auto-shopify-setup.vercel.app/theme-en.zip"
    : "https://auto-shopify-setup.vercel.app/theme.zip";
  
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
        src: themeZipUrl
      }
    })
  });
  const themeUploadData = await themeUploadRes.json();
  return themeUploadData?.theme?.id;
}
