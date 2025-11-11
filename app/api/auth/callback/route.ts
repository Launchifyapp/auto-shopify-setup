import { NextRequest, NextResponse } from "next/server";
import { runFullSetup } from "@/lib/setup";


// ⚠️ Pour prod, ajoute la vérification HMAC/state.
// Ici on fait simple pour démarrer.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop")!;
  const code = url.searchParams.get("code")!;

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    })
  });
  const tokenJson: any = await tokenRes.json();
  const token = tokenJson.access_token as string;

  // TODO: sauvegarder {shop, token} en base si besoin.

  // Lance toute la configuration auto
  await runFullSetup({ shop, token });

  return NextResponse.redirect(`https://${shop}/admin/apps`);
}
