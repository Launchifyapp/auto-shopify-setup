export async function uploadTheme({ shop, token }: { shop: string; token: string }) {
  // URL du thème ZIP hardcodée ici
  const themeZipUrl = "https://auto-shopify-setup.vercel.app/theme.zip";
  
  const themeUploadRes = await fetch(`https://${shop}/admin/api/2023-07/themes.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      theme: {
        name: "Dreamify V2 FR",
        src: themeZipUrl
      }
    })
  });
  const themeUploadData = await themeUploadRes.json();
  return themeUploadData?.theme?.id;
}
