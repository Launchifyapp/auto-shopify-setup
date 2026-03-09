"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Language, t } from "@/lib/i18n";

function PrivacyContent() {
  const searchParams = useSearchParams();
  const langParam = searchParams?.get("lang") ?? "fr";
  const lang: Language = langParam === "en" ? "en" : "fr";

  return (
    <main style={{ maxWidth: "800px", margin: "4rem auto", padding: "0 2rem" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "2rem" }}>{t(lang, "privacyTitle")}</h1>
      
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>{t(lang, "privacyIntroTitle")}</h2>
        <p style={{ lineHeight: 1.7 }}>{t(lang, "privacyIntroText")}</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>{t(lang, "privacyDataTitle")}</h2>
        <p style={{ lineHeight: 1.7 }}>{t(lang, "privacyDataText")}</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>{t(lang, "privacyMerchantDataTitle")}</h2>
        <p style={{ lineHeight: 1.7 }}>{t(lang, "privacyMerchantDataText")}</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>{t(lang, "privacyGDPRTitle")}</h2>
        <p style={{ lineHeight: 1.7 }}>{t(lang, "privacyGDPRText")}</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>{t(lang, "privacyContactTitle")}</h2>
        <p style={{ lineHeight: 1.7 }}>
          {t(lang, "privacyContactText")}{" "}
          <a href="mailto:support@launchify.tech" style={{ color: "#0066cc" }}>
            support@launchify.tech
          </a>
        </p>
      </section>

      <p style={{ marginTop: "3rem", color: "#666", fontSize: "0.9rem" }}>
        {t(lang, "privacyLastUpdated")}
      </p>
    </main>
  );
}

export default function PrivacyPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", marginTop: "8rem" }}>Loading...</div>}>
      <PrivacyContent />
    </Suspense>
  );
}
