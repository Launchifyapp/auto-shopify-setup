import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Language, t } from "@/lib/i18n";
import { authenticatedFetch } from "@/lib/utils/sessionToken";

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
        // Determine if we should use session tokens (embedded app) or direct fetch (non-embedded)
        const isEmbedded = typeof window !== 'undefined' && window.shopify !== undefined;
        
        // Use the appropriate fetch method
        const apiFetch = isEmbedded ? authenticatedFetch : fetch;
        
        setStep(1);
        // 1. Setup boutique
        const res1 = await apiFetch(`/api/setup-shop?shop=${encodeURIComponent(shop)}&lang=${lang}`);
        const data1 = await res1.json();
        if (!data1.ok) throw new Error(data1.error || t(lang, "errorSetup"));

        setStep(2);
        // 2. Upload theme
        const res2 = await apiFetch(`/api/upload-theme?shop=${encodeURIComponent(shop)}&lang=${lang}`);
        const data2 = await res2.json();
        if (!data2.ok || !data2.themeId) throw new Error(data2.error || t(lang, "errorThemeUpload"));

        setStep(3);
        // 3. Publish theme
        const res3 = await apiFetch(`/api/publish-theme?shop=${encodeURIComponent(shop)}&themeId=${data2.themeId}`);
        const data3 = await res3.json();
        if (!data3.ok) throw new Error(data3.error || t(lang, "errorThemePublish"));

        // 4. Success
        window.location.href = `/success?lang=${lang}`;
      } catch (e: any) {
        setError(e.message || t(lang, "generalError"));
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
