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
  // Apply customizations to the currently active theme
  await applyThemeCustomizations({ shop, token, themeId, lang });
  return { ok: true };
}
