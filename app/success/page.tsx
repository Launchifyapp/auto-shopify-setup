export default function SuccessPage() {
  return (
    <main style={{ textAlign:"center",marginTop:"8rem"}}>
      <h1 style={{ fontSize:"2rem",color:"#30a950" }}>✅ Installation réussie !</h1>
      <p style={{ fontSize:"1.1rem",margin:"2rem"}}>
        Félicitations, votre boutique Shopify a été automatisée.<br/>
        Vous pouvez maintenant personnaliser votre site et commencer à vendre !
      </p>
      <a href="https://admin.shopify.com/store" target="_blank" style={{
        display:"inline-block",background:"#31c17b",color:"white",borderRadius:8,padding:"1rem 2rem",textDecoration:"none",fontWeight:500
      }}>Accéder à l'admin Shopify</a>
      <p style={{marginTop:"3rem",color:"#888"}}>
        Si vous avez besoin d'aide, <a href="mailto:support@votreapp.com">contactez le support</a>
      </p>
    </main>
  );
}
