export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* App Bridge loaded from Shopify CDN - Required for Shopify app review */}
        {/* Using versioned URL to ensure latest security updates and fixes */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge/v3"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
