import { NextRequest } from "next/server";
import { setupShop } from "@/lib/setupShop"; // Assure que setupShop est exporté NOMMÉ dans lib/setupShop.ts

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  if (!shop || !token) {
    return Response.json({ ok: false, error: "Paramètres shop/token manquants !" }, { status: 400 });
  }
  try {
    await setupShop({ shop, token });
    return Response.json({ ok: true, message: "Setup boutique terminé !" });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
