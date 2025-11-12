"use client";
import { useEffect, useState } from "react";

export default function LoadingPage({ searchParams }: { searchParams: { shop: string, token: string } }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.shop && searchParams.token) {
      fetch(`/api/setup?shop=${encodeURIComponent(searchParams.shop)}&token=${encodeURIComponent(searchParams.token)}`)
        .then(res => res.json())
        .then(data => {
          if (data.ok) setDone(true);
          else setError(data.error || "Erreur inconnue");
        })
        .catch(() => setError("Erreur réseau ou serveur."));
    } else {
      setError("Paramètres manquants.");
    }
  }, [searchParams.shop, searchParams.token]);

  useEffect(() => {
    if (done) {
      window.location.href = '/success';
    }
  }, [done]);

  return (
    <div style={{ textAlign:'center', marginTop:'10rem' }}>
      <h1>Installation en cours…</h1>
      <p>Merci de patienter pendant l’automatisation de votre boutique Shopify.</p>
      {error && <p style={{ color: 'red' }}>❌ {error}</p>}
      <div className="spinner" />
      <style>{`
        .spinner { margin:2rem auto; border:4px solid #eee; border-top:4px solid #3f86e0; border-radius:50%; width:48px; height:48px; animation:spin 1s linear infinite;}
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
