import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Language, t } from "@/lib/i18n";
import { authenticatedFetch } from "@/lib/utils/sessionToken";

/** Wrapper around authenticatedFetch that aborts after `ms` milliseconds */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await authenticatedFetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default function Loader() {
  const searchParams = useSearchParams();
  const shop = searchParams?.get("shop") ?? "";
  const langParam = searchParams?.get("lang") ?? "fr";
  const lang: Language = langParam === "en" ? "en" : "fr";
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fullSetup() {
      try {
        setStep(1);
        console.log("[Loader] Starting step 1 – setup shop");
        // 1. Setup boutique (session token auth via App Bridge)
        const res1 = await fetchWithTimeout(`/api/setup-shop?lang=${lang}`, 150_000);
        const data1 = await res1.json();
        console.log("[Loader] Step 1 response:", data1);
        if (!data1.ok) throw new Error(data1.error || t(lang, "errorSetup"));

        setStep(2);
        console.log("[Loader] Starting step 2 – upload theme");
        // 2. Upload theme
        const res2 = await fetchWithTimeout(`/api/upload-theme?lang=${lang}`, 150_000);
        const data2 = await res2.json();
        console.log("[Loader] Step 2 response:", data2);
        if (!data2.ok || !data2.themeId) throw new Error(data2.error || t(lang, "errorThemeUpload"));

        setStep(3);
        console.log("[Loader] Starting step 3 – publish theme");
        // 3. Publish theme
        const res3 = await fetchWithTimeout(`/api/publish-theme?themeId=${data2.themeId}`, 150_000);
        const data3 = await res3.json();
        console.log("[Loader] Step 3 response:", data3);
        if (!data3.ok) throw new Error(data3.error || t(lang, "errorThemePublish"));

        // 4. Success
        window.location.href = `/success?lang=${lang}`;
      } catch (e: any) {
        console.error("[Loader] Error:", e);
        const msg =
          e?.name === "AbortError"
            ? t(lang, "generalError") + " (timeout)"
            : e?.message || t(lang, "generalError");
        setError(msg);
      }
    }

    if (shop) fullSetup();
    else setError(t(lang, "missingParams"));
  }, [shop, lang]);

  const stepText = t(lang, "loadingStep").replace("{step}", String(step));

  const steps = [
    { num: 1, label: lang === "fr" ? "Configuration" : "Setup" },
    { num: 2, label: lang === "fr" ? "Thème" : "Theme" },
    { num: 3, label: lang === "fr" ? "Publication" : "Publish" },
  ];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "2rem 1rem",
    }}>
      {/* Logo */}
      <img
        src="/images/logo.png"
        alt="Launchify"
        style={{ height: "40px", marginBottom: "2rem" }}
      />

      {/* Card */}
      <div style={{
        backgroundColor: "#fff",
        borderRadius: "16px",
        boxShadow: "0 4px 24px rgba(11,27,58,0.08)",
        padding: "2.5rem 2rem",
        maxWidth: "500px",
        width: "100%",
        textAlign: "center",
      }}>
        <h1 style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color: "#0B1B3A",
          margin: "0 0 0.5rem 0",
        }}>
          {t(lang, "loadingTitle")}
        </h1>
        <p style={{
          color: "#5a6a80",
          fontSize: "0.95rem",
          margin: "0 0 2rem 0",
        }}>
          {stepText}
        </p>

        {/* Progress steps */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0",
          marginBottom: "2rem",
        }}>
          {steps.map((s, i) => (
            <div key={s.num} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: step >= s.num ? "#00AAFF" : "#e8ecf0",
                  color: step >= s.num ? "#fff" : "#8895a7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: "0.9rem",
                  transition: "all 0.3s ease",
                  boxShadow: step === s.num ? "0 0 0 4px rgba(0,170,255,0.2)" : "none",
                }}>
                  {step > s.num ? "\u2713" : s.num}
                </div>
                <span style={{
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color: step >= s.num ? "#0B1B3A" : "#8895a7",
                  marginTop: "0.4rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div style={{
                  width: "60px",
                  height: "3px",
                  backgroundColor: step > s.num ? "#00AAFF" : "#e8ecf0",
                  margin: "0 0.5rem",
                  marginBottom: "1.2rem",
                  borderRadius: "2px",
                  transition: "background-color 0.3s ease",
                }} />
              )}
            </div>
          ))}
        </div>

        {/* Spinner */}
        {!error && (
          <>
            <div className="launchify-spinner" />
            <style>{`
              .launchify-spinner {
                margin: 0 auto;
                border: 4px solid #e8ecf0;
                border-top: 4px solid #00AAFF;
                border-radius: 50%;
                width: 44px;
                height: 44px;
                animation: launchify-spin 0.8s linear infinite;
              }
              @keyframes launchify-spin { to { transform: rotate(360deg); } }
            `}</style>
          </>
        )}

        {/* Error */}
        {error && (
          <div style={{
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "12px",
            padding: "1rem 1.25rem",
            color: "#dc2626",
            fontSize: "0.9rem",
            lineHeight: 1.5,
            textAlign: "left",
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
