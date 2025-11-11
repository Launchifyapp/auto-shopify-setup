export default function Page() {
  return (
    <main style={{padding: 24, fontFamily: "system-ui"}}>
      <h1>Shopify Setup App</h1>
      <p>⚙️ Cette app configure automatiquement une boutique à l’installation.</p>
      <ol>
        <li>Créer pages Livraison & FAQ</li>
        <li>Créer 2 collections (tags)</li>
        <li>Mettre à jour le menu principal</li>
        <li>Importer produits (CSV) + images</li>
        <li>Uploader et publier le thème</li>
      </ol>
      <p>
        Pour tester, lance l’URL d’installation : <code>/api/auth?shop=ton-shop.myshopify.com</code>
      </p>
    </main>
  );
}
