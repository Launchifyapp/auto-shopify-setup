import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const shop = searchParams.get("shop");

  const client_id = process.env.SHOPIFY_API_KEY!;
  const client_secret = process.env.SHOPIFY_API_SECRET!;

  if (!code || !shop) {
    return new Response(JSON.stringify({ error: "Missing code or shop param" }), { status: 400 });
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
    // Tu peux stocker l'access_token ici (DB, KV...)
    console.log("Access Token Shopify:", data.access_token);
    return new Response(JSON.stringify({ access_token: data.access_token, scope: data.scope }), { status: 200 });
  } else {
    return new Response(JSON.stringify({ error: "No access_token in response", details: data }), { status: 400 });
  }
}
