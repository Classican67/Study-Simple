import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fiches", template: "%s · Fiches" },
  description: "Cartes de révision auto-hébergées",
  applicationName: "Fiches",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Fiches" },
  // Évite que Safari transforme les nombres d'une carte en liens téléphoniques.
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  // `viewport-fit=cover` pour que le fond passe sous l'encoche en mode PWA.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
};

// Posé avant le premier rendu : sans lui, la page s'affiche une frame en clair
// avant que React n'applique le thème sombre.
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem("fiches-theme");
    var dark = stored === "dark" ||
      ((!stored || stored === "system") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" suppressHydrationWarning className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
