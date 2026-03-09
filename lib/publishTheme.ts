export async function publishTheme({ shop, token, themeId }: { shop: string; token: string; themeId: number }) {
  let statusOk = false, tries = 0;
  while (!statusOk && tries < 20) {
    await new Promise(res => setTimeout(res, 2000));
    tries++;
    const resTheme = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const themeDetail = await resTheme.json();
    if (themeDetail?.theme?.role === "unpublished" && themeDetail?.theme?.processing === false) {
      statusOk = true;
    }
  }
  if (statusOk) {
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
  return { ok: false, error: "thème non prêt ou timeout" };
}
