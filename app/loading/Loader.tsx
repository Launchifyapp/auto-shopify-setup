import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function Loader() {
  const searchParams = useSearchParams();
  const shop = searchParams?.get("shop") ?? "";
  const token = searchParams?.get("token") ?? "";
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fullSetup() {
      try {
        setStep(1);
        // 1. Setup boutique
        const res1 = await fetch(`/api/setup-shop?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`);
        const data1 = await res1.json();
        if (!data1.ok) throw new Error(data1.error || "Erreur setup boutique");

        setStep(2);
        // 2. Upload thème
        const res2 = await fetch(`/api/upload-theme?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`);
        const data2 = await res2.json();
        if (!data2.ok || !data2.themeId) throw new Error(data2.error || "Erreur upload thème");

        setStep(3);
        // 3. Publication du thème
        const res3 = await fetch(`/api/publish-theme?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}&themeId=${data2.themeId}`);
        const data3 = await res3.json();
        if (!data3.ok) throw new Error(data3.error || "Erreur publication thème");

        // 4. Succès
        window.location.href = "/success";
      } catch (e: any) {
        setError(e.message || "Erreur générale automatisation");
      }
    }

    if (shop && token) fullSetup();
    else setError("Paramètres manquants.");
  }, [shop, token]);

  return (
    <div style={{ textAlign:"center",marginTop:"10rem" }}>
      <h1>Installation en cours…</h1>
      <p>Étape {step}/3. Merci de patienter pendant l’automatisation complète de votre boutique Shopify.</p>
      {error && <p style={{ color:"red", fontSize:"1.7rem"}}>❌ {error}</p>}
      <div className="spinner" />
      <style>{`
        .spinner { margin:2rem auto; border:4px solid #eee; border-top:4px solid #3f86e0; border-radius:50%; width:48px; height:48px; animation:spin 1s linear infinite;}
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
