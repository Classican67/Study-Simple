"use client";

import * as React from "react";
import { FileUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pageRatios } from "@/components/note/pdf-page";
import { addDocumentBlocks, importNoteDocument } from "@/app/(app)/notes/actions";

/**
 * Importe un document et en fait autant de pages annotables.
 *
 * Le PDF est stocké tel quel ; un document Word est converti par LibreOffice à
 * l'import. Le comptage et le format des pages sont relevés ici, où le PDF est
 * de toute façon chargé pour être affiché.
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
  const [etat, setEtat] = React.useState<"pret" | "envoi" | "lecture">("pret");

  async function choisir(file: File) {
    setEtat("envoi");
    const data = new FormData();
    data.set("document", file);
    const envoi = await importNoteDocument(data);

    if (!envoi.ok) {
      setEtat("pret");
      onError(envoi.error);
      return;
    }

    setEtat("lecture");
    try {
      const ratios = await pageRatios(envoi.file);
      const result = await addDocumentBlocks(noteId, envoi.file, ratios);
      if (!result.ok) onError(result.error);
      else onImported(result.blocks);
    } catch (cause) {
      console.error(
        "[import] lecture du PDF impossible :",
        cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      );
      onError("Ce PDF n'a pas pu être lu.");
    } finally {
      setEtat("pret");
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        // Les types acceptés sont ceux que le serveur sait traiter ; il revérifie.
        accept=".pdf,.docx,.doc,.odt,.rtf,application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Le champ est remis à zéro : réimporter le même fichier doit
          // redéclencher l'événement.
          event.target.value = "";
          if (file) void choisir(file);
        }}
      />
      <Button
        variant="outlined"
        onClick={() => inputRef.current?.click()}
        disabled={etat !== "pret"}
        title="PDF, ou document Word converti à l'import"
      >
        {etat === "pret" ? <FileUp /> : <Loader2 className="animate-spin" />}
        {etat === "envoi" ? "Conversion…" : etat === "lecture" ? "Lecture…" : "Document"}
      </Button>
    </>
  );
}
