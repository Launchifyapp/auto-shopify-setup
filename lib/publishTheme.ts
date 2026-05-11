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
  // Step 1: wait for processing flag to clear
  let processingDone = false, tries = 0;
  while (!processingDone && tries < 40) {
    await new Promise(res => setTimeout(res, 3000));
    tries++;
    const resTheme = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const themeDetail = await resTheme.json();
    if (themeDetail?.theme?.role === "unpublished" && themeDetail?.theme?.processing === false) {
      processingDone = true;
    }
  }
  if (!processingDone) {
    return { ok: false, error: "thème non prêt ou timeout" };
  }

  // Step 2: verify layout/theme.liquid is present (Theme Store install may lag behind processing flag)
  let themeReady = false, readyTries = 0;
  while (!themeReady && readyTries < 20) {
    await new Promise(res => setTimeout(res, 5000));
    readyTries++;
    const resAsset = await fetch(
      `https://${shop}/admin/api/2023-07/themes/${themeId}/assets.json?asset[key]=layout/theme.liquid`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (resAsset.ok) {
      themeReady = true;
    } else {
      console.log(`[publishTheme] layout/theme.liquid not ready yet (attempt ${readyTries}/20)`);
    }
  }
  if (!themeReady) {
    return { ok: false, error: "fichiers du thème introuvables après installation (layout/theme.liquid manquant)" };
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
