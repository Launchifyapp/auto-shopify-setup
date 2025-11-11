export const metadata = {
  title: "Shopify Setup App",
  description: "Installe et configure automatiquement la boutique",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui" }}>{children}</body>
    </html>
  );
}
