// Exemple PATCH pour gérer la variable session lors de l'appel à setupShop
// Tu adapteras l'import/setupShop selon ton arborescence
import { setupShop } from "../../../lib/setupShop"; // <-- adapte ce chemin selon ton repo

export async function POST(req: Request) {
  // Ici, on récupère shop et token selon ton logique (corps de requête, env, etc.)
  // Exemple :
  // const { shop, token } = await req.json();
  // Pour le test, tu peux hardcoder ou extraire selon besoin

  // MOCK / PATCH : Ajoute une session vide pour corriger le bug
  const session = {}; // <-- Patch ici. Adapte avec la vraie session Shopify quand tu veux.

  // Récupère shop et token
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
    await setupShop({ shop, token, session }); // <-- session est bien déclaré !
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
