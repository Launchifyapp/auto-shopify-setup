export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* App Bridge loaded from Shopify CDN - Required for Shopify app review */}
        {/* Using the latest App Bridge script from Shopify's CDN */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
