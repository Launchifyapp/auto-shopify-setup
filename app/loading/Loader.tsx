import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Language, t } from "@/lib/i18n";
import { authenticatedFetch } from "@/lib/utils/sessionToken";

const REFRESH_THEME_STORE_URL = "https://themes.shopify.com/themes/refresh/styles/default";

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

/** Safely parse a response as JSON, with fallback for non-JSON (e.g. HTML error pages) */
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status}): ${text.substring(0, 200)}`);
  }
}

export default function Loader() {
  const searchParams = useSearchParams();
  const shop = searchParams?.get("shop") ?? "";
  const langParam = searchParams?.get("lang") ?? "fr";
  const lang: Language = langParam === "en" ? "en" : "fr";

  const [phase, setPhase] = useState<"preInstall" | "running">("preInstall");
  const [step, setStep] = useState(1);
  const [subStep, setSubStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function fullSetup() {
    try {
      // ─── Step 1: Setup shop (multi-phase) ───
      setStep(1);
      setSubStep(lang === "fr" ? "Initialisation..." : "Initializing...");

      const res1 = await fetchWithTimeout(`/api/setup-shop?phase=init&lang=${lang}`, 120_000);
      const data1 = await safeJson(res1);
      if (!data1.ok) throw new Error(data1.error || t(lang, "errorSetup"));

      const { setupId, totalBatches } = data1;

      for (let batch = 0; batch < totalBatches; batch++) {
        const progress = Math.round(((batch + 1) / totalBatches) * 100);
        setSubStep(
          lang === "fr"
            ? `Création des produits... ${progress}%`
            : `Creating products... ${progress}%`
        );
        const res2 = await fetchWithTimeout(
          `/api/setup-shop?phase=products&setupId=${encodeURIComponent(setupId)}&batch=${batch}`,
          120_000
        );
        const data2 = await safeJson(res2);
        if (!data2.ok) throw new Error(data2.error || t(lang, "errorSetup"));
      }

      setSubStep(lang === "fr" ? "Publication..." : "Publishing...");
      const res3 = await fetchWithTimeout(
        `/api/setup-shop?phase=finalize&setupId=${encodeURIComponent(setupId)}`,
        120_000
      );
      const data3 = await safeJson(res3);
      if (!data3.ok) throw new Error(data3.error || t(lang, "errorSetup"));

      // ─── Step 2: Find Refresh theme ───
      setStep(2);
      setSubStep("");
      const res4 = await fetchWithTimeout(`/api/upload-theme`, 30_000);
      const data4 = await safeJson(res4);
      if (!data4.ok || !data4.themeId) throw new Error(data4.error || t(lang, "errorThemeUpload"));

      // ─── Step 3: Apply customizations + Publish ───
      setStep(3);
      const res5 = await fetchWithTimeout(`/api/publish-theme?themeId=${data4.themeId}&lang=${lang}`, 150_000);
      const data5 = await safeJson(res5);
      if (!data5.ok) throw new Error(data5.error || t(lang, "errorThemePublish"));

      // ─── Success ───
      window.location.href = `/success?lang=${lang}&shop=${encodeURIComponent(shop)}`;
    } catch (e: any) {
      const msg =
        e?.name === "AbortError"
          ? t(lang, "generalError") + " (timeout)"
          : e?.message || t(lang, "generalError");
      setError(msg);
    }
  }

  useEffect(() => {
    if (!shop) setError(t(lang, "missingParams"));
  }, [shop, lang]);

  const stepText = t(lang, "loadingStep").replace("{step}", String(step));

  const steps = [
    { num: 1, label: lang === "fr" ? "Configuration" : "Setup" },
    { num: 2, label: lang === "fr" ? "Thème" : "Theme" },
    { num: 3, label: lang === "fr" ? "Publication" : "Publish" },
  ];

  // ─── Pre-install screen ───
  if (phase === "preInstall" && !error) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem 1rem",
      }}>
        <img src="/images/logo.png" alt="Launchify" style={{ height: "40px", marginBottom: "2rem" }} />

        <div style={{
          backgroundColor: "#fff",
          borderRadius: "16px",
          boxShadow: "0 4px 24px rgba(11,27,58,0.08)",
          padding: "2.5rem 2rem",
          maxWidth: "520px",
          width: "100%",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🎨</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0B1B3A", margin: "0 0 0.75rem 0" }}>
            {t(lang, "preInstallTitle")}
          </h1>
          <p style={{ color: "#5a6a80", fontSize: "0.95rem", margin: "0 0 0.5rem 0" }}>
            {t(lang, "preInstallDescription")}
          </p>
          <p style={{ color: "#5a6a80", fontSize: "0.9rem", margin: "0 0 2rem 0" }}>
            {t(lang, "preInstallInstruction")}
          </p>

          <a
            href={REFRESH_THEME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              backgroundColor: "#f0f7ff",
              color: "#00AAFF",
              border: "1.5px solid #00AAFF",
              borderRadius: "8px",
              padding: "0.75rem 1.5rem",
              fontWeight: 700,
              fontSize: "0.95rem",
              textDecoration: "none",
              marginBottom: "1rem",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            🔗 {t(lang, "preInstallOpenTheme")}
          </a>

          <button
            onClick={() => {
              setPhase("running");
              fullSetup();
            }}
            style={{
              display: "block",
              width: "100%",
              backgroundColor: "#00AAFF",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "0.85rem 1.5rem",
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: "pointer",
            }}
          >
            {t(lang, "preInstallContinue")}
          </button>
        </div>
      </div>
    );
  }

  // ─── Running screen ───
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "2rem 1rem",
    }}>
      <img src="/images/logo.png" alt="Launchify" style={{ height: "40px", marginBottom: "2rem" }} />

      <div style={{
        backgroundColor: "#fff",
        borderRadius: "16px",
        boxShadow: "0 4px 24px rgba(11,27,58,0.08)",
        padding: "2.5rem 2rem",
        maxWidth: "500px",
        width: "100%",
        textAlign: "center",
      }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0B1B3A", margin: "0 0 0.5rem 0" }}>
          {t(lang, "loadingTitle")}
        </h1>
        <p style={{ color: "#5a6a80", fontSize: "0.95rem", margin: "0 0 0.5rem 0" }}>
          {stepText}
        </p>

        {subStep && !error && (
          <p style={{ color: "#00AAFF", fontSize: "0.85rem", fontWeight: 600, margin: "0 0 1.5rem 0" }}>
            {subStep}
          </p>
        )}
        {!subStep && <div style={{ marginBottom: "1.5rem" }} />}

        {/* Progress steps */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0", marginBottom: "2rem" }}>
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
                  {step > s.num ? "✓" : s.num}
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
