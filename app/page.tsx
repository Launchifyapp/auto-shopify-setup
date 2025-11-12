"use client";
import { useState } from "react";

export default function InstallLanding() {
  const [shop, setShop] = useState("");
 const CLIENT_ID = process.env.SHOPIFY_API_KEY!;
  const REDIRECT_URI = "https://auto-shopify-setup.vercel.app/api/auth/callback";
  const SCOPES = "write_products,write_themes,write_content";

  function startInstall() {
    if (!shop.endsWith(".myshopify.com")) {
      alert("Entrer un shop valide, ex: monboutique.myshopify.com");
      return;
    }
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    window.location.href = installUrl;
  }

  return (
    <main style={{ textAlign:"center", marginTop:"8rem" }}>
      <h1 style={{ fontSize:"2rem" }}>Installer l'app Shopify automatique</h1>
      <p>Entrez votre nom de boutique Shopify pour lancer l'installation de l'app sur votre store.</p>
      <input
        type="text"
        placeholder="votreshop.myshopify.com"
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
        Installer l'app sur Shopify
      </button>
      <p style={{ marginTop:"2rem", color:"#888" }}>
        Après installation, l'automatisation de votre boutique démarre <br />
        (pages, produits, thème).
      </p>
    </main>
  );
}
