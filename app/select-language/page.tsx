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
    <main style={{ textAlign: "center", marginTop: "8rem", position: "relative" }}>
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

      <h1 style={{ fontSize: "2rem" }}>{t(displayLang, "selectStoreLanguageTitle")}</h1>
      <p>{t(displayLang, "selectStoreLanguageDescription")}</p>

      <div style={{ margin: "2rem auto", maxWidth: "320px" }}>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
          {t(displayLang, "selectStoreLanguage")}
        </label>
        <select
          value={storeLang}
          onChange={e => setStoreLang(e.target.value as Language)}
          style={{ fontSize: "1.1rem", padding: "0.5rem", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
        >
          <option value="fr">🇫🇷 Français</option>
          <option value="en">🇬🇧 English</option>
        </select>
      </div>

      <button
        style={{ 
          fontSize: "1.2rem", 
          padding: "0.75rem 2rem", 
          backgroundColor: "#008060", 
          color: "white", 
          border: "none", 
          borderRadius: "4px", 
          cursor: "pointer" 
        }}
        onClick={startInstallation}
      >
        {t(displayLang, "startInstallation")}
      </button>

      <p style={{ marginTop: "2rem", color: "#888" }}>
        {t(displayLang, "afterInstallMessage")} <br />
        {t(displayLang, "afterInstallDetails")}
      </p>
    </main>
  );
}

export default function SelectLanguagePage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", marginTop: "8rem" }}>Loading…</div>}>
      <SelectLanguageContent />
    </Suspense>
  );
}
