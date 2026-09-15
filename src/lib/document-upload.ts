import { MAX_DOCUMENT_BYTES } from "@/lib/upload-path";

/**
 * Envoi d'un document à la route d'import, avec sa progression.
 *
 * Partagé par le bouton « Document » du bas de la note et par la barre
 * d'outils d'une page manuscrite. XHR et non `fetch` : c'est la seule API du
 * navigateur qui rapporte l'avancement d'un **envoi**, et trente mégaoctets
 * depuis un iPad prennent une minute — sans pourcentage, on croit à un blocage.
 */

/** Au-delà, on renonce : le réseau s'est endormi. */
const TIMEOUT_MS = 5 * 60 * 1000;

export type EnvoiDocument = { progres: number; phase: "envoi" | "traitement" };

/** L'envoi a été interrompu à la demande : rien à signaler. */
export class EnvoiInterrompu extends Error {}

export function envoyerDocument<T>(
  url: string,
  file: File,
  onProgress: (etat: EnvoiDocument) => void,
): { promesse: Promise<T>; interrompre: () => void } {
  const xhr = new XMLHttpRequest();

  const promesse = new Promise<T>((resolve, reject) => {
    // Refusé ici plutôt qu'après une minute d'envoi : la taille est connue
    // avant d'ouvrir la connexion.
    if (file.size > MAX_DOCUMENT_BYTES) {
      const mo = (file.size / 1024 / 1024).toFixed(1);
      reject(
        new Error(
          `Document trop lourd : ${mo} Mo, pour ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo au maximum. ` +
            "Exporte-le en qualité réduite, ou coupe-le en deux.",
        ),
      );
      return;
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progres = Math.min(99, Math.round((event.loaded / event.total) * 100));
      // À cent pour cent d'envoi, le serveur convertit et découpe encore : le
      // dire évite de croire à un blocage sur la dernière barre.
      onProgress({ progres, phase: progres >= 99 ? "traitement" : "envoi" });
    };
    xhr.upload.onload = () => onProgress({ progres: 100, phase: "traitement" });

    xhr.onload = () => {
      let charge: (T & { error?: string }) | null = null;
      try {
        charge = JSON.parse(xhr.responseText);
      } catch {
        // Une page d'erreur HTML plutôt que du JSON : le proxy a coupé, ou
        // c'est la limite de taille du reverse proxy qui a répondu.
        reject(
          new Error(
            xhr.status === 413
              ? "Document refusé par le serveur : trop lourd."
              : `L'import a échoué (réponse ${xhr.status}).`,
          ),
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && charge) resolve(charge);
      else reject(new Error(charge?.error ?? `L'import a échoué (réponse ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Connexion perdue pendant l'import."));
    xhr.onabort = () => reject(new EnvoiInterrompu());
    xhr.ontimeout = () => reject(new Error("L'import a pris trop de temps et a été interrompu."));
    xhr.timeout = TIMEOUT_MS;

    const data = new FormData();
    data.set("document", file);
    xhr.open("POST", url);
    xhr.send(data);
    onProgress({ progres: 0, phase: "envoi" });
  });

  return { promesse, interrompre: () => xhr.abort() };
}

/** Les formats que la route d'import sait traiter. */
export const DOCUMENT_ACCEPT = ".pdf,.docx,.doc,.odt,.rtf,application/pdf";

/** Le fichier choisi est-il un document plutôt qu'une image ? */
export function estDocument(file: File): boolean {
  return file.type === "application/pdf" || /\.(pdf|docx?|odt|rtf)$/i.test(file.name);
}
