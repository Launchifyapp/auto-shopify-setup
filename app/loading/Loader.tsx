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

  return (
    <div style={{ textAlign:"center",marginTop:"10rem" }}>
      <h1>{t(lang, "loadingTitle")}</h1>
      <p>{stepText}</p>
      {error && <p style={{ color:"red", fontSize:"1.7rem"}}>❌ {error}</p>}
      <div className="spinner" />
      <style>{`
        .spinner { margin:2rem auto; border:4px solid #eee; border-top:4px solid #3f86e0; border-radius:50%; width:48px; height:48px; animation:spin 1s linear infinite;}
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
