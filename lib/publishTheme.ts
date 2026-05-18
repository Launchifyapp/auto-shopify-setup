export async function publishTheme({
  shop,
  token,
  themeId,
}: {
  shop: string;
  token: string;
  themeId: number;
}) {
  console.log(`[publishTheme] Publishing theme via REST. shop=${shop} themeId=${themeId}`);

  const res = await fetch(`https://${shop}/admin/api/2023-07/themes/${themeId}.json`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ theme: { role: "main" } }),
  });

  const text = await res.text();
  console.log(`[publishTheme] PUT response: status=${res.status} body=${text.substring(0, 300)}`);

  if (!res.ok) {
    throw new Error(`Failed to publish theme: ${res.status} ${text}`);
  }

  return { ok: true };
}
