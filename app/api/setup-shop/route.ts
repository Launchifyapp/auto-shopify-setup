import { setupShop } from "../../../lib/setupShop";

export async function POST(req: Request) {
  // Récupération des paramètres du body (shop, token)
  let shop = "";
  let token = "";
  try {
    const body = await req.json();
    shop = body.shop;
    token = body.token;
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, message: "Missing shop or token" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // PATCH : Appel sans session, car setupShop n'accepte que { shop, token }
    await setupShop({ shop, token });
    return new Response(
      JSON.stringify({ ok: true, message: "Setup boutique terminé !" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, message: "Erreur lors du setup", details: err?.message || "unknown" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
