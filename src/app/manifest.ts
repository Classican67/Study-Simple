import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fiches — cartes de révision",
    short_name: "Fiches",
    description: "Réviser ses cours par paquets de cartes, hors ligne et auto-hébergé.",
    start_url: "/",
    // `standalone` retire la barre d'URL une fois l'app ajoutée à l'écran d'accueil.
    display: "standalone",
    // Pas d'orientation imposée : sur iPad, le paysage est le mode naturel.
    background_color: "#131218",
    theme_color: "#131218",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // `maskable` laisse Android recadrer l'icône dans sa forme système
      // sans rogner le dessin.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
