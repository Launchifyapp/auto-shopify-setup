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

  const [subStep, setSubStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function fullSetup() {
    try {
      // ─── Init ───
      setSubStep(lang === "fr" ? "Initialisation..." : "Initializing...");
      const res1 = await fetchWithTimeout(`/api/setup-shop?phase=init&lang=${lang}`, 120_000);
      const data1 = await safeJson(res1);
      if (!data1.ok) throw new Error(data1.error || t(lang, "errorSetup"));

      const { setupId, totalBatches } = data1;

      // ─── Products batches ───
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

      // ─── Finalize ───
      setSubStep(lang === "fr" ? "Finalisation..." : "Finalizing...");
      const res3 = await fetchWithTimeout(
        `/api/setup-shop?phase=finalize&setupId=${encodeURIComponent(setupId)}`,
        120_000
      );
      const data3 = await safeJson(res3);
      if (!data3.ok) throw new Error(data3.error || t(lang, "errorSetup"));

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
    if (!shop) {
      setError(t(lang, "missingParams"));
      return;
    }
    fullSetup();
  }, []);

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
        <p style={{ color: "#5a6a80", fontSize: "0.95rem", margin: "0 0 1rem 0" }}>
          {t(lang, "loadingSubtitle")}
        </p>

        {subStep && !error && (
          <p style={{ color: "#00AAFF", fontSize: "0.85rem", fontWeight: 600, margin: "0 0 1.5rem 0" }}>
            {subStep}
          </p>
        )}
        {!subStep && !error && <div style={{ marginBottom: "1.5rem" }} />}

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
