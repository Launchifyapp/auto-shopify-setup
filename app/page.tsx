"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Language, t } from "@/lib/i18n";

// OAuth scopes - must match lib/scopes.ts ALL_SCOPES
const SCOPES = "read_products,write_products,read_content,write_content,read_files,write_files,read_themes,write_themes,read_online_store_pages,write_online_store_pages,read_online_store_navigation,write_online_store_navigation,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_locations,read_inventory,write_inventory,read_publications";

function InstallLandingContent() {
  const searchParams = useSearchParams();
  const [shop, setShop] = useState("");
  const [displayLang, setDisplayLang] = useState<Language>("fr");
  const [redirecting, setRedirecting] = useState(false);
  
  const CLIENT_ID = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || "ta_cle_api_shopify";
  const REDIRECT_URI = "https://launchify.tech/api/auth/callback";

  // When the app is opened from Shopify Admin (embedded), Shopify adds
  // both "shop" and "host" query parameters to the URL. Detect this and
  // redirect to the language selection page instead of showing the
  // installation form.
  // Use window.location.href instead of router.push() because Next.js
  // client-side navigation does not work reliably inside the Shopify
  // Admin embedded iframe with App Bridge loaded.
  useEffect(() => {
    const shopParam = searchParams?.get("shop");
    const hostParam = searchParams?.get("host");
    if (shopParam && hostParam) {
      setRedirecting(true);
      window.location.href = `/select-language?shop=${encodeURIComponent(shopParam)}`;
    }
  }, [searchParams]);

  if (redirecting) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", color: "#0B1B3A", fontSize: "1.1rem",
      }}>
        Redirecting…
      </div>
    );
  }

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

  const isValid = shop.endsWith(".myshopify.com");

  return (
    <main style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "2rem 1rem",
    }}>
      {/* Language switcher */}
      <div style={{ position: "fixed", top: "1.25rem", right: "1.5rem", zIndex: 10 }}>
        <select
          value={displayLang}
          onChange={e => setDisplayLang(e.target.value as Language)}
          style={{
            fontSize: "0.85rem",
            padding: "0.45rem 0.75rem",
            borderRadius: "10px",
            border: "1px solid #dde1e6",
            backgroundColor: "#fff",
            color: "#0B1B3A",
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <option value="fr">🇫🇷 Français</option>
          <option value="en">🇬🇧 English</option>
        </select>
      </div>

      {/* Logo */}
      <div style={{
        fontSize: "1.75rem",
        fontWeight: 800,
        color: "#0B1B3A",
        letterSpacing: "0.08em",
        marginBottom: "2rem",
        textTransform: "uppercase",
      }}>
        <span style={{ color: "#00AAFF" }}>Launch</span>ify
      </div>

      {/* Card */}
      <div style={{
        backgroundColor: "#fff",
        borderRadius: "16px",
        boxShadow: "0 4px 24px rgba(11,27,58,0.08)",
        padding: "2.5rem 2rem",
        maxWidth: "460px",
        width: "100%",
        textAlign: "center",
      }}>
        <h1 style={{
          fontSize: "1.65rem",
          fontWeight: 800,
          color: "#0B1B3A",
          margin: "0 0 0.5rem 0",
          lineHeight: 1.3,
        }}>
          {t(displayLang, "installTitle")}
        </h1>
        <p style={{
          color: "#5a6a80",
          fontSize: "0.95rem",
          margin: "0 0 2rem 0",
          lineHeight: 1.6,
        }}>
          {t(displayLang, "installDescription")}
        </p>

        <input
          type="text"
          placeholder={t(displayLang, "shopPlaceholder")}
          value={shop}
          onChange={e => setShop(e.target.value)}
          style={{
            fontSize: "1rem",
            padding: "0.85rem 1rem",
            width: "100%",
            boxSizing: "border-box",
            borderRadius: "12px",
            border: "2px solid #dde1e6",
            outline: "none",
            fontFamily: "inherit",
            color: "#0B1B3A",
            transition: "border-color 0.2s",
            marginBottom: "1.25rem",
          }}
          onFocus={e => (e.target.style.borderColor = "#00AAFF")}
          onBlur={e => (e.target.style.borderColor = "#dde1e6")}
        />

        <button
          style={{
            fontSize: "0.95rem",
            fontWeight: 800,
            padding: "0.9rem 2rem",
            width: "100%",
            backgroundColor: isValid ? "#00AAFF" : "#b0d4f1",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: isValid ? "pointer" : "not-allowed",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "inherit",
            boxShadow: isValid ? "0 4px 14px rgba(0,170,255,0.3)" : "none",
            transition: "background-color 0.2s, box-shadow 0.2s",
          }}
          onClick={startInstall}
          disabled={!isValid}
          onMouseEnter={e => { if (isValid) (e.target as HTMLButtonElement).style.backgroundColor = "#0099ee"; }}
          onMouseLeave={e => { if (isValid) (e.target as HTMLButtonElement).style.backgroundColor = "#00AAFF"; }}
        >
          {t(displayLang, "installButton")}
        </button>
      </div>

      <p style={{
        marginTop: "2rem",
        color: "#8895a7",
        fontSize: "0.85rem",
        textAlign: "center",
        lineHeight: 1.7,
        maxWidth: "400px",
      }}>
        {t(displayLang, "afterInstallMessage")} <br />
        {t(displayLang, "afterInstallDetails")}
      </p>
    </main>
  );
}

export default function InstallLanding() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#0B1B3A" }}>Loading…</div>}>
      <InstallLandingContent />
    </Suspense>
  );
}
