import crypto from "node:crypto";
import fetch from "node-fetch";

const API_VERSION = "2024-10";

function verifyHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  const message = Object.keys(rest).sort().map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`).join("&");
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

async function httpHead(url) {
  // Certains environnements n’acceptent pas HEAD → on fait un GET “stream”
  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) throw new Error(`ZIP URL not reachable: ${resp.status}`);
  // petite lecture d’1 octet pour valider l’accès
  return true;
}

async function createThemeFromZip(shop, token, zipUrl, themeName) {
  const resp = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ theme: { name: themeName || "Launchify Theme", src: zipUrl } })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`theme create ${resp.status} :: ${text}`);
  return JSON.parse(text).theme; // { id }
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
    await new Promise(r => setTimeout(r, intervalMs));
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

export default async function handler(req, res) {
  const { shop, code } = req.query;
  const report = []; // on accumule les logs pour te les afficher

  try {
    if (!shop || !code) {
      return res.status(400).send("Missing shop/code");
    }
    if (!verifyHmac(req.query, process.env.SHOPIFY_API_SECRET)) {
      return res.status(400).send("HMAC invalid");
    }

    report.push(`shop=${shop}`);
    report.push(`APP_URL=${process.env.APP_URL}`);
    report.push(`THEME_ZIP_URL=${process.env.THEME_ZIP_URL}`);

    const { access_token } = await exchangeToken(
      shop,
      code,
      process.env.SHOPIFY_API_KEY,
      process.env.SHOPIFY_API_SECRET
    );
    report.push("access_token OK");

    // Test accessibilité ZIP
    if (!process.env.THEME_ZIP_URL) {
      report.push("THEME_ZIP_URL missing, skipping theme import.");
    } else {
      try {
        await httpHead(process.env.THEME_ZIP_URL);
        report.push("ZIP reachable OK");

        const created = await createThemeFromZip(shop, access_token, process.env.THEME_ZIP_URL, process.env.THEME_NAME);
        report.push(`theme created id=${created.id}`);

        let ready;
        try {
          ready = await waitUntilThemeReady(shop, access_token, created.id);
          report.push(`theme ready id=${ready.id}`);
        } catch (e) {
          report.push(`wait ready skipped: ${e.message} (continuing)`);
          ready = created;
        }

        const published = await publishTheme(shop, access_token, ready.id);
        report.push(`theme published id=${published.id} name=${published.name}`);
      } catch (e) {
        report.push(`THEME ERROR :: ${e.message}`);
      }
    }

    return res
      .status(200)
      .send(`<pre>${report.map(l => `• ${l}`).join('\n')}</pre><p><a href="https://${shop}/admin">Admin</a></p>`);
  } catch (e) {
    report.push(`FATAL :: ${e.message}`);
    return res.status(500).send(`<pre>${report.map(l => `• ${l}`).join('\n')}</pre>`);
  }
}
