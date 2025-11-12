"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoadingPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shop && token) {
      fetch(`/api/setup?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`)
        .then(res => res.json())
        .then(data => {
          if (data.ok) setDone(true);
          else setError(data.error || "Erreur inconnue !");
        })
        .catch(() => setError("Erreur réseau ou serveur."));
    } else {
      setError("Paramètres manquants.");
    }
  }, [shop, token]);

  useEffect(() => {
    if (done) {
      window.location.href = "/success";
    }
  }, [done]);

  return (
    <div style={{ textAlign:"center",marginTop:"10rem" }}>
      <h1>Installation en cours…</h1>
      <p>Merci de patienter pendant l’automatisation de votre boutique Shopify.</p>
      {error && <p style={{ color:"red", fontSize:"1.7rem"}}>❌ {error}</p>}
      <div className="spinner" />
      <style>{`
        .spinner { margin:2rem auto; border:4px solid #eee; border-top:4px solid #3f86e0; border-radius:50%; width:48px; height:48px; animation:spin 1s linear infinite;}
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
