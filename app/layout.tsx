// app/layout.tsx
import React from "react";

export const metadata = {
  title: "Shopify Setup App",
  description: "Installe et configure automatiquement la boutique",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        {children}
      </body>
    </html>
  );
}
