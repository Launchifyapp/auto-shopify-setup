"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Language, t } from "@/lib/i18n";

function SuccessContent() {
  const searchParams = useSearchParams();
  const langParam = searchParams?.get("lang") ?? "fr";
  const lang: Language = langParam === "en" ? "en" : "fr";

  return (
    <main style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "2rem 1rem",
    }}>
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
        maxWidth: "480px",
        width: "100%",
        textAlign: "center",
      }}>
        {/* Checkmark circle */}
        <div style={{
          width: "72px",
          height: "72px",
          borderRadius: "50%",
          backgroundColor: "#00AAFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1.5rem auto",
          boxShadow: "0 4px 14px rgba(0,170,255,0.3)",
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 style={{
          fontSize: "1.65rem",
          fontWeight: 800,
          color: "#0B1B3A",
          margin: "0 0 0.75rem 0",
        }}>
          {t(lang, "successTitle")}
        </h1>
        <p style={{
          fontSize: "0.95rem",
          color: "#5a6a80",
          margin: "0 0 2rem 0",
          lineHeight: 1.7,
        }}>
          {t(lang, "successMessage")}<br/>
          {t(lang, "successDetails")}
        </p>

        <a
          href="https://admin.shopify.com/store"
          target="_blank"
          style={{
            display: "inline-block",
            backgroundColor: "#00AAFF",
            color: "#fff",
            borderRadius: "12px",
            padding: "0.9rem 2.5rem",
            textDecoration: "none",
            fontWeight: 800,
            fontSize: "0.95rem",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "inherit",
            boxShadow: "0 4px 14px rgba(0,170,255,0.3)",
            transition: "background-color 0.2s",
          }}
          onMouseEnter={e => (e.target as HTMLAnchorElement).style.backgroundColor = "#0099ee"}
          onMouseLeave={e => (e.target as HTMLAnchorElement).style.backgroundColor = "#00AAFF"}
        >
          {t(lang, "accessAdmin")}
        </a>
      </div>

      <p style={{
        marginTop: "2rem",
        color: "#8895a7",
        fontSize: "0.85rem",
        textAlign: "center",
      }}>
        {t(lang, "needHelp")}{" "}
        <a
          href="mailto:support@votreapp.com"
          style={{ color: "#00AAFF", textDecoration: "none", fontWeight: 600 }}
        >
          {t(lang, "contactSupport")}
        </a>
      </p>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#00AAFF", fontSize: "2rem" }}>...</div>}>
      <SuccessContent />
    </Suspense>
  );
}
