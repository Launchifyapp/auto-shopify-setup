import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");

  // --- Config thèmes
  const API_VERSION = process.env.SHOPIFY_API_VERSION || "2023-07";
  const themeName = "Dreamify V2 FR";
  const themeUrl = "https://auto-shopify-setup.vercel.app/DREAMIFY.zip";

  if (!shop || !token) {
    return Response.json({ ok: false, error: "Paramètres shop/token manquants !" }, { status: 400 });
  }

  // 1. Upload du thème ZIP
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

  // 2. Publication automatique du thème
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

  // --- Tu peux ajouter ici d'autres automatisations !

  // --- Réponse finale
  return Response.json({ ok: true, themeId, published: true });
}
