"use client";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { Language, t } from "@/lib/i18n";

function SelectLanguageContent() {
  const searchParams = useSearchParams();
  const shop = searchParams?.get("shop") ?? "";
  const displayLangParam = searchParams?.get("displayLang") ?? "fr";
  
  const [displayLang, setDisplayLang] = useState<Language>(displayLangParam === "en" ? "en" : "fr");
  const [storeLang, setStoreLang] = useState<Language>("fr");

  function startInstallation() {
    if (!shop) {
      alert(t(displayLang, "missingParams"));
      return;
    }
    // Token is now stored server-side, not passed in URL
    window.location.href = `/loading?shop=${encodeURIComponent(shop)}&lang=${storeLang}`;
  }

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
          {t(displayLang, "selectStoreLanguageTitle")}
        </h1>
        <p style={{
          color: "#5a6a80",
          fontSize: "0.95rem",
          margin: "0 0 2rem 0",
          lineHeight: 1.6,
        }}>
          {t(displayLang, "selectStoreLanguageDescription")}
        </p>

        <div style={{ marginBottom: "1.5rem", textAlign: "left" }}>
          <label style={{
            display: "block",
            marginBottom: "0.5rem",
            fontWeight: 600,
            fontSize: "0.85rem",
            color: "#0B1B3A",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            {t(displayLang, "selectStoreLanguage")}
          </label>
          <select
            value={storeLang}
            onChange={e => setStoreLang(e.target.value as Language)}
            style={{
              fontSize: "1rem",
              padding: "0.85rem 1rem",
              width: "100%",
              boxSizing: "border-box",
              borderRadius: "12px",
              border: "2px solid #dde1e6",
              backgroundColor: "#fff",
              color: "#0B1B3A",
              fontFamily: "inherit",
              cursor: "pointer",
              outline: "none",
              appearance: "none",
              WebkitAppearance: "none",
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%230B1B3A' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 1rem center",
              backgroundSize: "12px",
            }}
          >
            <option value="fr">🇫🇷 Français</option>
            <option value="en">🇬🇧 English</option>
          </select>
        </div>

        <button
          style={{
            fontSize: "0.95rem",
            fontWeight: 800,
            padding: "0.9rem 2rem",
            width: "100%",
            backgroundColor: "#00AAFF",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "inherit",
            boxShadow: "0 4px 14px rgba(0,170,255,0.3)",
            transition: "background-color 0.2s, box-shadow 0.2s",
          }}
          onClick={startInstallation}
          onMouseEnter={e => (e.target as HTMLButtonElement).style.backgroundColor = "#0099ee"}
          onMouseLeave={e => (e.target as HTMLButtonElement).style.backgroundColor = "#00AAFF"}
        >
          {t(displayLang, "startInstallation")}
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

export default function SelectLanguagePage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#0B1B3A" }}>Loading…</div>}>
      <SelectLanguageContent />
    </Suspense>
  );
}
