import localFont from "next/font/local";

/**
 * Roboto Flex, auto-hébergée dans public/fonts.
 *
 * C'est la police de Material 3 : la même que celle du système Android. La
 * choisir ici fait que l'app web et la future app native partagent exactement
 * la même identité typographique — et le sous-ensemble « latin » couvre
 * entièrement le français.
 *
 * Variable : une seule requête couvre toutes les graisses de l'échelle
 * typographique, de `label small` à `display large`.
 */
export const sans = localFont({
  src: "../../public/fonts/roboto-flex-latin.woff2",
  weight: "300 800",
  display: "swap",
  variable: "--font-sans-local",
  // Aligne les métriques du repli : le texte ne saute pas quand la vraie
  // police prend le relais.
  adjustFontFallback: "Arial",
  fallback: ["Roboto", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
});
