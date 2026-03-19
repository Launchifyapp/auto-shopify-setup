"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Language, t } from "@/lib/i18n";

function BrandingUpsellContent() {
  const searchParams = useSearchParams();
  const purchaseId = searchParams?.get("purchaseId") ?? "";
  const langParam = searchParams?.get("lang") ?? "fr";
  const lang: Language = langParam === "en" ? "en" : "fr";

  const handleAddBranding = async () => {
    if (purchaseId) {
      console.log("Adding branding with purchaseId:", purchaseId);
    }
  };

  const handleSkip = () => {
    window.location.href = `/`;
  };

  return (
    <main
      style={{
        background: "#ffffff",
        minHeight: "100vh",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      }}
    >
      {/* Header - LAUNCHIFY logo */}
      <div
        style={{
          textAlign: "center",
          padding: "2rem 1rem 1rem",
        }}
      >
        <span
          style={{
            fontSize: "1.5rem",
            fontWeight: "400",
            color: "#1e293b",
            letterSpacing: "0.35em",
            textTransform: "uppercase",
          }}
        >
          L
          <span style={{ color: "#0ea5e9", fontSize: "1.5rem" }}>A</span>
          UNCHIFY
        </span>
      </div>

      {/* Hero Section */}
      <div
        style={{
          textAlign: "center",
          maxWidth: "900px",
          margin: "0 auto",
          padding: "1.5rem 2rem 2rem",
        }}
      >
        <p
          style={{
            color: "#0ea5e9",
            fontSize: "1.1rem",
            fontStyle: "italic",
            fontWeight: "600",
            margin: "0 0 0.75rem 0",
          }}
        >
          {t(lang, "upsellBrandingSpecialOffer")}
        </p>
        <h1
          style={{
            fontSize: "2.5rem",
            fontWeight: "800",
            color: "#0f172a",
            margin: "0 0 1rem 0",
            lineHeight: "1.15",
          }}
        >
          {t(lang, "upsellBrandingTitle")}
        </h1>
        <p
          style={{
            fontSize: "1.05rem",
            color: "#64748b",
            margin: "0",
          }}
        >
          {t(lang, "upsellBrandingSubtitle")}
        </p>
      </div>

      {/* Two-Column Section: Image + Feature Card */}
      <div
        style={{
          maxWidth: "1000px",
          margin: "1.5rem auto 3rem",
          padding: "0 2rem",
          display: "flex",
          alignItems: "center",
          gap: "2rem",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {/* Left - Branding Image */}
        <div
          style={{
            flex: "1 1 420px",
            maxWidth: "500px",
            minWidth: "280px",
          }}
        >
          <img
            src="https://statics.myclickfunnels.com/workspace/jdBAOz/image/2608289/file/8132f3955f03990c654fcb08bf4d29d2.jpg"
            alt="Premium Branding Pack Preview"
            style={{
              width: "100%",
              height: "auto",
              borderRadius: "4px",
            }}
          />
        </div>

        {/* Right - Feature Card */}
        <div
          style={{
            flex: "1 1 340px",
            maxWidth: "420px",
            minWidth: "280px",
            background: "#dbeafe",
            borderRadius: "12px",
            padding: "2rem 2rem 1.75rem",
          }}
        >
          <h2
            style={{
              fontSize: "1.6rem",
              fontWeight: "800",
              color: "#0f172a",
              margin: "0 0 0.75rem 0",
            }}
          >
            {t(lang, "upsellBrandingPackTitle")}
          </h2>
          <p
            style={{
              fontSize: "1.05rem",
              fontWeight: "700",
              color: "#0ea5e9",
              margin: "0 0 1.5rem 0",
            }}
          >
            {t(lang, "upsellBrandingPriceIntro")}
          </p>

          {/* Features List */}
          {[
            t(lang, "upsellBrandingFeature1"),
            t(lang, "upsellBrandingFeature2"),
            t(lang, "upsellBrandingFeature3"),
          ].map((feature, idx) => (
            <div key={idx}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "0.85rem 0",
                }}
              >
                {/* Blue circle check */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "24px",
                    height: "24px",
                    background: "#0ea5e9",
                    color: "white",
                    borderRadius: "50%",
                    marginRight: "1rem",
                    fontSize: "0.8rem",
                    fontWeight: "700",
                    flexShrink: 0,
                  }}
                >
                  ✓
                </span>
                <span
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: "600",
                    color: "#0f172a",
                  }}
                >
                  {feature}
                </span>
              </div>
              {idx < 2 && (
                <div
                  style={{
                    borderBottom: "1px solid #bfdbfe",
                    margin: "0",
                  }}
                />
              )}
            </div>
          ))}

          {/* Note */}
          <p
            style={{
              fontSize: "0.9rem",
              color: "#0f172a",
              marginTop: "1.25rem",
              marginBottom: "0",
              lineHeight: "1.5",
            }}
          >
            {t(lang, "upsellBrandingNote")}
          </p>
        </div>
      </div>

      {/* CTA Section */}
      <div
        style={{
          maxWidth: "500px",
          margin: "0 auto 4rem",
          padding: "0 2rem",
          textAlign: "center",
        }}
      >
        <button
          onClick={handleAddBranding}
          style={{
            width: "100%",
            padding: "1.1rem 2rem",
            background: "#0ea5e9",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontSize: "1.1rem",
            fontWeight: "700",
            cursor: "pointer",
            marginBottom: "1rem",
            transition: "background 0.2s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "#0284c7";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "#0ea5e9";
          }}
        >
          {t(lang, "upsellBrandingCTA")}
        </button>

        <button
          onClick={handleSkip}
          style={{
            width: "100%",
            padding: "0.75rem 2rem",
            background: "transparent",
            color: "#0ea5e9",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.9rem",
            fontWeight: "600",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.textDecoration = "underline";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.textDecoration = "none";
          }}
        >
          {t(lang, "upsellBrandingSkip")}
        </button>
      </div>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid #e2e8f0",
          padding: "2rem 1rem",
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: "1rem" }}>
          <span
            style={{
              fontSize: "1rem",
              fontWeight: "400",
              color: "#1e293b",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
            }}
          >
            L
            <span style={{ color: "#0ea5e9" }}>A</span>
            UNCHIFY
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1.5rem",
            flexWrap: "wrap",
            fontSize: "0.85rem",
          }}
        >
          {[
            { label: "Confidentialit\u00e9", href: `/${lang}/legal/privacy` },
            { label: "Conditions d'utilisation", href: `/${lang}/legal/terms` },
            { label: "Remboursements", href: `/${lang}/legal/refunds` },
            { label: "Contact", href: `/${lang}/legal/contact` },
            { label: "Centre d'aide", href: `/${lang}/legal/help` },
          ].map((link, idx) => (
            <a
              key={idx}
              href={link.href}
              style={{
                color: "#64748b",
                textDecoration: "none",
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
        <p
          style={{
            marginTop: "1rem",
            fontSize: "0.8rem",
            color: "#94a3b8",
          }}
        >
          Copyright &copy; 2026 LAUNCHIFY | All Rights Reserved.
        </p>
      </footer>
    </main>
  );
}

export default function BrandingUpsellPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            textAlign: "center",
            marginTop: "8rem",
            fontSize: "1.1rem",
            color: "#666",
          }}
        >
          Chargement...
        </div>
      }
    >
      <BrandingUpsellContent />
    </Suspense>
  );
}
