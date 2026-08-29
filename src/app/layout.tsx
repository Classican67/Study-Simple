import type { Metadata, Viewport } from "next";

import { display, sans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fiches", template: "%s · Fiches" },
  description: "Cartes de révision auto-hébergées",
  applicationName: "Fiches",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Fiches" },
  // Évite que Safari transforme les nombres d'une carte en liens téléphoniques.
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // `viewport-fit=cover` pour que le fond passe sous l'encoche en mode PWA.
  viewportFit: "cover",
  // Le zoom reste possible (jamais maximumScale: 1, qui casse l'accessibilité),
  // mais la largeur initiale est celle de l'appareil.
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#131218" },
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
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
