"use client";
import { useState } from "react";
import { Language, t } from "@/lib/i18n";

export default function InstallLanding() {
  const [shop, setShop] = useState("");
  const [lang, setLang] = useState<Language>("fr");
  
  const CLIENT_ID = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || "ta_cle_api_shopify";
  const REDIRECT_URI = "https://auto-shopify-setup.vercel.app/api/auth/callback";
  const SCOPES = "write_products,write_themes,write_content";

  function startInstall() {
    if (!shop.endsWith(".myshopify.com")) {
      alert(t(lang, "invalidShopAlert"));
      return;
    }
    // Pass language in state parameter to preserve it through OAuth
    const state = encodeURIComponent(JSON.stringify({ lang }));
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
    window.location.href = installUrl;
  }

  return (
    <main style={{ textAlign:"center", marginTop:"8rem" }}>
      <h1 style={{ fontSize:"2rem" }}>{t(lang, "installTitle")}</h1>
      <p>{t(lang, "installDescription")}</p>
      
      <div style={{ margin: "1.5rem auto", maxWidth: "320px" }}>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
          {t(lang, "selectLanguage")}
        </label>
        <select
          value={lang}
          onChange={e => setLang(e.target.value as Language)}
          style={{ fontSize: "1.1rem", padding: "0.5rem", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
        >
          <option value="fr">🇫🇷 Français</option>
          <option value="en">🇬🇧 English</option>
        </select>
      </div>
      
      <input
        type="text"
        placeholder={t(lang, "shopPlaceholder")}
        value={shop}
        onChange={e => setShop(e.target.value)}
        style={{ fontSize:"1.2rem", padding:"0.5rem", width:"320px", margin:"1rem" }}
      />
      <br />
      <button
        style={{ fontSize:"1.2rem", padding:"0.75rem 2rem" }}
        onClick={startInstall}
        disabled={!shop.endsWith(".myshopify.com")}
      >
        {t(lang, "installButton")}
      </button>
      <p style={{ marginTop:"2rem", color:"#888" }}>
        {t(lang, "afterInstallMessage")} <br />
        {t(lang, "afterInstallDetails")}
      </p>
    </main>
  );
}
