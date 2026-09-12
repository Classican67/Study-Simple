"use client";

import * as React from "react";
import { FileUp, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAX_DOCUMENT_BYTES } from "@/lib/upload-path";

/**
 * Importe un document et en fait une page annotable par page.
 *
 * Le PDF est stocké tel quel ; un document Word est converti par LibreOffice à
 * l'import. Tout se joue en **une** requête vers `/api/notes/<id>/document` :
 * envoi, relevé du format des pages, création de la page manuscrite.
 *
 * Trois choses ont bloqué cet import sur iPad, et les trois se voient ici :
 *
 * 1. **Le plafond d'une action serveur** — un mégaoctet — refusait la requête
 *    avant tout appel de code. La promesse était rejetée sans que personne ne
 *    l'attrape, et le bouton restait sur « Conversion… » indéfiniment.
 * 2. **L'absence de progression.** Trente mégaoctets depuis un iPad prennent
 *    une minute : sans pourcentage, rien ne distingue un envoi en cours d'un
 *    blocage. XHR est la seule API du navigateur qui rapporte l'avancement
 *    d'un envoi — `fetch` ne le fait pas.
 * 3. **Aucune sortie de secours.** Un réseau qui s'endort laissait l'état de
 *    chargement pour toujours. Il y a donc un délai de garde, un bouton pour
 *    interrompre, et un `finally` qui rend la main quoi qu'il arrive.
 */

/** Au-delà, on renonce : le réseau s'est endormi. */
const TIMEOUT_MS = 5 * 60 * 1000;

type Envoi = { progres: number; phase: "envoi" | "traitement" };

export function ImportDocument({
  noteId,
  onImported,
  onError,
}: {
  noteId: string;
  /** Reçoit les pages créées, pour les afficher sans recharger la note. */
  onImported: (blocks: { id: string; kind: string; content: string }[]) => void;
  onError: (message: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const requete = React.useRef<XMLHttpRequest | null>(null);
  const [envoi, setEnvoi] = React.useState<Envoi | null>(null);

  // Quitter la page pendant un envoi ne doit pas laisser la requête pendante.
  React.useEffect(() => () => requete.current?.abort(), []);

  function choisir(file: File) {
    // Refusé ici plutôt qu'après une minute d'envoi : la taille est connue
    // avant d'ouvrir la connexion.
    if (file.size > MAX_DOCUMENT_BYTES) {
      const mo = (file.size / 1024 / 1024).toFixed(1);
      onError(
        `Document trop lourd : ${mo} Mo, pour ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo au maximum. ` +
          "Exporte-le en qualité réduite, ou coupe-le en deux.",
      );
      return;
    }

    const data = new FormData();
    data.set("document", file);

    const xhr = new XMLHttpRequest();
    requete.current = xhr;
    setEnvoi({ progres: 0, phase: "envoi" });

    const fini = (message?: string) => {
      requete.current = null;
      setEnvoi(null);
      if (message) onError(message);
    };

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progres = Math.min(99, Math.round((event.loaded / event.total) * 100));
      // À cent pour cent d'envoi, le serveur convertit et découpe encore : le
      // dire évite de croire à un blocage sur la dernière barre.
      setEnvoi({ progres, phase: progres >= 99 ? "traitement" : "envoi" });
    };
    xhr.upload.onload = () => setEnvoi({ progres: 100, phase: "traitement" });

    xhr.onload = () => {
      let charge: { blocks?: { id: string; kind: string; content: string }[]; error?: string } = {};
      try {
        charge = JSON.parse(xhr.responseText);
      } catch {
        // Une page d'erreur HTML plutôt que du JSON : le proxy a coupé, ou
        // c'est la limite de taille du reverse proxy qui a répondu.
        fini(
          xhr.status === 413
            ? "Document refusé par le serveur : trop lourd."
            : `L'import a échoué (réponse ${xhr.status}).`,
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && charge.blocks) {
        fini();
        onImported(charge.blocks);
        return;
      }
      fini(charge.error ?? `L'import a échoué (réponse ${xhr.status}).`);
    };

    xhr.onerror = () => fini("Connexion perdue pendant l'import.");
    xhr.onabort = () => fini();
    xhr.ontimeout = () => fini("L'import a pris trop de temps et a été interrompu.");
    xhr.timeout = TIMEOUT_MS;

    xhr.open("POST", `/api/notes/${noteId}/document`);
    xhr.send(data);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        // Les types acceptés sont ceux que le serveur sait traiter ; il
        // revérifie, et se rabat sur l'extension quand iOS n'annonce pas de
        // type.
        accept=".pdf,.docx,.doc,.odt,.rtf,application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Le champ est remis à zéro : réimporter le même fichier doit
          // redéclencher l'événement.
          event.target.value = "";
          if (file) choisir(file);
        }}
      />

      {envoi ? (
        <span className="inline-flex items-center gap-1">
          <Button variant="outlined" disabled aria-live="polite">
            <Loader2 className="animate-spin" />
            {envoi.phase === "envoi" ? `Envoi ${envoi.progres} %` : "Conversion…"}
          </Button>
          {/* Une sortie, toujours : un envoi qui traîne ne doit pas obliger à
              recharger la page. */}
          <Button
            variant="text"
            aria-label="Interrompre l'import"
            title="Interrompre l'import"
            onClick={() => requete.current?.abort()}
          >
            <X />
          </Button>
        </span>
      ) : (
        <Button
          variant="outlined"
          onClick={() => inputRef.current?.click()}
          title="PDF, ou document Word converti à l'import"
        >
          <FileUp />
          Document
        </Button>
      )}
    </>
  );
}
