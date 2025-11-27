"use client";
import { useState } from "react";
import { Language, t } from "@/lib/i18n";

// OAuth scopes - must match lib/scopes.ts ALL_SCOPES
const SCOPES = "read_products,write_products,read_content,write_content,read_files,write_files,read_themes,write_themes,read_online_store_pages,write_online_store_pages,read_online_store_navigation,write_online_store_navigation,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects";

export default function InstallLanding() {
  const [shop, setShop] = useState("");
  const [displayLang, setDisplayLang] = useState<Language>("fr");
  
  const CLIENT_ID = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || "ta_cle_api_shopify";
  const REDIRECT_URI = "https://launchify.tech/api/auth/callback";

  function startInstall() {
    if (!shop.endsWith(".myshopify.com")) {
      alert(t(displayLang, "invalidShopAlert"));
      return;
    }
    // Pass display language in state parameter to preserve it through OAuth
    const state = encodeURIComponent(JSON.stringify({ displayLang }));
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
    window.location.href = installUrl;
  }

  return (
    <main style={{ textAlign:"center", marginTop:"8rem", position: "relative" }}>
      <div style={{ position: "absolute", top: "-6rem", right: "1rem" }}>
        <select
          value={displayLang}
          onChange={e => setDisplayLang(e.target.value as Language)}
          style={{ fontSize: "0.9rem", padding: "0.4rem", borderRadius: "4px", border: "1px solid #ccc" }}
        >
          <option value="fr">🇫🇷 Français</option>
          <option value="en">🇬🇧 English</option>
        </select>
      </div>
      
      <h1 style={{ fontSize:"2rem" }}>{t(displayLang, "installTitle")}</h1>
      <p>{t(displayLang, "installDescription")}</p>
      
      <input
        type="text"
        placeholder={t(displayLang, "shopPlaceholder")}
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
        {t(displayLang, "installButton")}
      </button>
      <p style={{ marginTop:"2rem", color:"#888" }}>
        {t(displayLang, "afterInstallMessage")} <br />
        {t(displayLang, "afterInstallDetails")}
      </p>
    </main>
  );
}
