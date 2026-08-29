import localFont from "next/font/local";

// Polices auto-hébergées, versionnées dans public/fonts : aucun appel réseau
// pendant le build, donc `docker build` fonctionne sur une machine sans accès
// sortant. Le sous-ensemble « latin » couvre entièrement le français, œ inclus.

// Titres : grotesque contemporain, un peu de caractère.
export const display = localFont({
  src: "../../public/fonts/bricolage-latin.woff2",
  weight: "300 800",
  display: "swap",
  variable: "--font-display",
  // Aligne les métriques de la police de repli sur celles de Bricolage :
  // le texte ne saute plus au moment où la vraie police prend le relais.
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
});

// Texte courant et interface.
export const sans = localFont({
  src: "../../public/fonts/inter-latin.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-sans",
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
});
