import { Language } from "@/lib/i18n";
import { applyThemeCustomizations } from "@/lib/applyThemeCustomizations";

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
  let statusOk = false, tries = 0;
  while (!statusOk && tries < 30) {
    await new Promise(res => setTimeout(res, 3000));
    tries++;
    const resTheme = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const themeDetail = await resTheme.json();
    if (themeDetail?.theme?.role === "unpublished" && themeDetail?.theme?.processing === false) {
      statusOk = true;
    }
  }
  if (!statusOk) {
    return { ok: false, error: "thème non prêt ou timeout" };
  }

  await applyThemeCustomizations({ shop, token, themeId, lang });

  await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      theme: { role: "main" }
    })
  });
  return { ok: true };
}
