import { NextRequest } from "next/server";
import { runFullSetup } from "@/lib/setup";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  
  if (!shop || !token)
    return Response.json({ ok: false, error: "Paramètres shop/token manquants !" }, { status: 400 });

  try {
    await runFullSetup({ shop, token });
    // Tu peux détailler plus la réponse si tu fais des retours intermédiaires dans runFullSetup
    return Response.json({ ok: true, message: "Automatisation complète effectuée !" });
  } catch (err) {
    return Response.json({ ok: false, error: "Erreur globale setup", details: String(err) }, { status: 500 });
  }
}
