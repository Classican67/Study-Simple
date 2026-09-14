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

    /*
     * Recevoir un document depuis le système.
     *
     * Deux mécanismes, et ils ne servent pas les mêmes gestes :
     *
     * - `share_target` fait apparaître l'app dans la **feuille de partage** :
     *   on ouvre un PDF, on le partage, et il devient une note.
     * - `file_handlers` la fait apparaître dans **« Ouvrir avec »** : le
     *   fichier arrive par `launchQueue`, que la liste des notes consomme.
     *
     * **Ni l'un ni l'autre n'existe sur iOS ni iPadOS** : Safari ne sait pas
     * faire d'une application web la destination d'un partage, et rien ne
     * l'annonce pour l'instant. Sur iPad, c'est le glisser-déposer depuis
     * Fichiers qui rend ce service — il fonctionne depuis iPadOS 15 et accepte
     * justement le PDF et le Word. Ces deux déclarations valent pour Android,
     * ChromeOS et les navigateurs de bureau, et l'app sera prête le jour où
     * Safari suivra.
     */
    share_target: {
      action: "/api/notes/import",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [
          {
            name: "document",
            accept: [
              "application/pdf",
              ".pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ".docx",
              "application/msword",
              ".doc",
              "application/vnd.oasis.opendocument.text",
              ".odt",
              "application/rtf",
              ".rtf",
            ],
          },
        ],
      },
    },

    file_handlers: [
      {
        action: "/notes",
        accept: {
          "application/pdf": [".pdf"],
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
          "application/msword": [".doc"],
          "application/vnd.oasis.opendocument.text": [".odt"],
          "application/rtf": [".rtf"],
        },
      },
    ],
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
