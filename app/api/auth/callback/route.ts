import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const shop = searchParams.get("shop");

  const client_id = process.env.SHOPIFY_API_KEY!;
  const client_secret = process.env.SHOPIFY_API_SECRET!;

  if (!code || !shop) {
    return new Response("Missing code or shop param", { status: 400 });
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id,
      client_secret,
      code,
    }),
  });

  const data = await response.json();

  if (data.access_token) {
    // TODO: Stockage token en base ou cookie, si besoin.

    // Redirection Next.js v13+/app API :
    return Response.redirect("https://ton-domaine.com/success", 302);
    // Ou, si tu as une page /success dans ton projet :
    // return Response.redirect("/success", 302);
  } else {
    return new Response("OAuth error", { status: 400 });
  }
}
