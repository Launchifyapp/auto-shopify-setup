import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");

  const API_VERSION = process.env.SHOPIFY_API_VERSION || "2023-07";
  const themeName = "Dreamify V2 FR";
  const themeUrl = "https://auto-shopify-setup.vercel.app/DREAMIFY.zip";

  if (!shop || !token) {
    return Response.json({ ok: false, error: "Paramètres shop/token manquants !" }, { status: 400 });
  }

  // 1. Upload du thème
  const createThemeRes = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      theme: { name: themeName, src: themeUrl }
    })
  });

  const created = await createThemeRes.json();
  const themeId = created?.theme?.id;

  if (!themeId) {
    return Response.json({ ok: false, error: "Échec upload thème!", details: created }, { status: 400 });
  }

  // 2. Poll jusqu'à ce que le thème soit prêt à être publié !
  let statusOk = false;
  let tries = 0;
  while (!statusOk && tries < 20) { // Attente max ~40sec
    await new Promise((res) => setTimeout(res, 2000)); // Pause 2s
    tries++;
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes/${themeId}.json`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const theme = await res.json();
    // On log pour debug, optionnel
    if (theme?.theme?.role === "unpublished" && theme?.theme?.processing === false) {
      statusOk = true;
    }
  }

  if (!statusOk) {
    return Response.json({ ok: false, error: "Le thème n'est pas prêt à être publié après 40s.", details: "status: waiting/timeout" }, { status: 400 });
  }

  // 3. Publication du thème
  const publishRes = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes/${themeId}.json`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({
      theme: { id: themeId, role: "main" }
    })
  });

  if (!publishRes.ok) {
    const err = await publishRes.text();
    return Response.json({ ok: false, error: "Erreur publication thème", details: err }, { status: 400 });
  }

  return Response.json({ ok: true, themeId, published: true });
}
