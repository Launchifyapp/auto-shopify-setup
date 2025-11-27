export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* App Bridge loaded from Shopify CDN - Required for Shopify app review */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
