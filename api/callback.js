const storefrontUrl = `https://${shop}`;
return res.status(200).send(`
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Boutique prête</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;padding:48px;background:#0b0b0c;color:#eaeaea;display:flex;align-items:center;justify-content:center}
        .card{background:#141416;border:1px solid #2a2a2e;border-radius:16px;max-width:520px;padding:32px;text-align:center;box-shadow:0 6px 30px rgba(0,0,0,.25)}
        h1{font-size:28px;margin:0 0 12px}
        p{opacity:.85;margin:0 0 24px}
        a.btn{display:inline-block;padding:14px 18px;border-radius:10px;border:1px solid #3a3a40;text-decoration:none;color:#fff;background:#3b82f6}
        a.btn:hover{filter:brightness(1.05)}
        .sub{margin-top:14px;font-size:13px;opacity:.7}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Ta boutique est prête ✅</h1>
        <p>Le thème a été importé et activé. Tu peux la voir tout de suite.</p>
        <a class="btn" href="${storefrontUrl}" target="_blank" rel="noopener">Voir ma boutique</a>
        <div class="sub"><a href="https://${shop}/admin" style="color:#9ca3af" target="_blank" rel="noopener">Accéder à l’admin</a></div>
      </div>
    </body>
  </html>
`);
