// api/callback.js
// Shopify -> /api/callback?shop=&code=&state=&hmac=...
import crypto from "node:crypto";
import fetch from "node-fetch";

const API_VERSION = "2024-10"; // compatible 2023-10+

function verifyHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return digest === hmac;
}

async function exchangeToken(shop, code, clientId, clientSecret) {
  const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`access_token ${resp.status} :: ${text}`);
  return JSON.parse(text); // { access_token, scope }
}

// ---------- THEME HELPERS ----------
async function zipReachable(url) {
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`ZIP URL not reachable: ${r.status}`);
  return true;
}

async function createThemeFromZip(shop, token, zipUrl, themeName) {
  const resp = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      theme: {
        name: themeName || "Launchify Theme",
        src: zipUrl
      }
    })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`theme create ${resp.status} :: ${text}`);
  return JSON.parse(text).theme; // { id, ... }
}

async function getTheme(shop, token, id) {
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes/${id}.json`, {
    headers: { "X-Shopify-Access-Token": token }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`theme get ${r.status} :: ${text}`);
  return JSON.parse(text).theme;
}

async function waitUntilThemeReady(shop, token, id, { timeoutMs = 120000, intervalMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getTheme(shop, token, id);
    if (!t.processing) return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("processing timeout");
}

async function publishTheme(shop, token, id) {
  const resp = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes/${id}.json`, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ theme: { id, role: "main" } })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`publish ${resp.status} :: ${text}`);
  return JSON.parse(text).theme;
}
// -----------------------------------

export default async function handler(req, res) {
  const { shop, code } = req.query;

  try {
    if (!shop || !code) return res.status(400).send("Missing shop/code.");
    if (!verifyHmac(req.query, process.env.SHOPIFY_API_SECRET)) {
      return res.status(400).send("HMAC invalid.");
    }

    // 1) OAuth → access_token
    const { access_token } = await exchangeToken(
      shop,
      code,
      process.env.SHOPIFY_API_KEY,
      process.env.SHOPIFY_API_SECRET
    );
    console.log("✅ Installed shop:", shop);

    // 2) Import + publish theme (si THEME_ZIP_URL défini)
    let publishedTheme = null;
    const zipUrl = process.env.THEME_ZIP_URL;
    const themeName = process.env.THEME_NAME || "Launchify Theme";

    if (zipUrl) {
      console.log("⬇️ Import theme from:", zipUrl);
      await zipReachable(zipUrl); // valide l'accès

      const created = await createThemeFromZip(shop, access_token, zipUrl, themeName);
      console.log("📦 Theme created:", created.id);

      let ready;
      try {
        ready = await waitUntilThemeReady(shop, access_token, created.id);
        console.log("⏳ Theme ready:", ready.id);
      } catch (e) {
        console.warn("⏱️ Could not confirm processing end, continuing:", e.message);
        ready = created;
      }

      publishedTheme = await publishTheme(shop, access_token, ready.id);
      console.log("🚀 Theme published as main:", publishedTheme.id, publishedTheme.name);
    } else {
      console.warn("⚠️ THEME_ZIP_URL not set, skipping theme import.");
    }

    // 3) Page finale minimaliste
    const storefrontUrl = `https://${shop}`;
    const html = `
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Boutique prête</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,sans-serif;background:#0b0b0c;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#121214;border:1px solid #232327;border-radius:16px;padding:32px;max-width:560px;width:92%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{font-size:24px;margin:0 0 8px}
    p{opacity:.9;margin:0 0 20px}
    .btn{display:inline-block;padding:14px 18px;border-radius:10px;text-decoration:none;background:#4ade80;color:#08210f;font-weight:600}
    .muted{font-size:13px;opacity:.7;margin-top:14px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Ta boutique est prête ✅</h1>
    <p>${publishedTheme ? `Thème <strong>${publishedTheme.name}</strong> publié.` : `Installation terminée.`}</p>
    <a class="btn" href="${storefrontUrl}" target="_top" rel="noopener">Voir ma boutique</a>
    <div class="muted">Boutique : ${shop}</div>
  </div>
</body>
</html>
    `.trim();

    return res.status(200).send(html);
  } catch (e) {
    console.error("Callback error:", e);
    return res.status(500).send(`Erreur pendant le callback: ${e.message}`);
  }
}
// ... après publication du thème
try {
  await fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/setup`, {
    method: 'POST',
    headers: { cookie: req.headers.cookie || '' }
  });
} catch (e) {
  console.error('Setup failed to trigger', e);
}
export default async function callback(req, res) {
  // ... ton code OAuth + installation du thème + set cookies

  // Redirection server-side : lance le seed puis renvoie son résultat
  res.redirect(302, '/api/setup');
}

