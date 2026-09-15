"use client";

import * as React from "react";
import { FileUp, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DOCUMENT_ACCEPT, EnvoiInterrompu, envoyerDocument, type EnvoiDocument } from "@/lib/document-upload";

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
 * 2. **L'absence de progression.** Cf. `envoyerDocument`.
 * 3. **Aucune sortie de secours.** Un réseau qui s'endort laissait l'état de
 *    chargement pour toujours. Il y a donc un délai de garde, un bouton pour
 *    interrompre, et un `finally` qui rend la main quoi qu'il arrive.
 */
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
  const interrompre = React.useRef<(() => void) | null>(null);
  const [envoi, setEnvoi] = React.useState<EnvoiDocument | null>(null);

  // Quitter la page pendant un envoi ne doit pas laisser la requête pendante.
  React.useEffect(() => () => interrompre.current?.(), []);

  async function choisir(file: File) {
    const requete = envoyerDocument<{ blocks?: { id: string; kind: string; content: string }[] }>(
      `/api/notes/${noteId}/document`,
      file,
      setEnvoi,
    );
    interrompre.current = requete.interrompre;
    try {
      const charge = await requete.promesse;
      if (charge.blocks) onImported(charge.blocks);
      else onError("L'import a échoué.");
    } catch (erreur) {
      if (!(erreur instanceof EnvoiInterrompu)) {
        onError(erreur instanceof Error ? erreur.message : "L'import a échoué.");
      }
    } finally {
      interrompre.current = null;
      setEnvoi(null);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        // Les types acceptés sont ceux que le serveur sait traiter ; il
        // revérifie, et se rabat sur l'extension quand iOS n'annonce pas de
        // type.
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Le champ est remis à zéro : réimporter le même fichier doit
          // redéclencher l'événement.
          event.target.value = "";
          if (file) void choisir(file);
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
            onClick={() => interrompre.current?.()}
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
