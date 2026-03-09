"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Language, t } from "@/lib/i18n";

function SuccessContent() {
  const searchParams = useSearchParams();
  const langParam = searchParams?.get("lang") ?? "fr";
  const lang: Language = langParam === "en" ? "en" : "fr";

  return (
    <main style={{ textAlign:"center",marginTop:"8rem"}}>
      <h1 style={{ fontSize:"2rem",color:"#30a950" }}>{t(lang, "successTitle")}</h1>
      <p style={{ fontSize:"1.1rem",margin:"2rem"}}>
        {t(lang, "successMessage")}<br/>
        {t(lang, "successDetails")}
      </p>
      <a href="https://admin.shopify.com/store" target="_blank" style={{
        display:"inline-block",background:"#31c17b",color:"white",borderRadius:8,padding:"1rem 2rem",textDecoration:"none",fontWeight:500
      }}>{t(lang, "accessAdmin")}</a>
      <p style={{marginTop:"3rem",color:"#888"}}>
        {t(lang, "needHelp")} <a href="mailto:support@votreapp.com">{t(lang, "contactSupport")}</a>
      </p>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div style={{ textAlign:"center",marginTop:"8rem"}}><h1 style={{ fontSize:"2rem",color:"#30a950" }}>✅</h1></div>}>
      <SuccessContent />
    </Suspense>
  );
}
