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
  await applyThemeCustomizations({ shop, token, themeId, lang });

  const res = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ theme: { role: "main" } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to publish theme: ${res.status} ${text}`);
  }

  return { ok: true };
}
