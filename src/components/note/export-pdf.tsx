"use client";

import { Download, FileCheck2, FilePenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/**
 * Export de la note annotée en PDF.
 *
 * Deux formes, celles des applications de référence, et la différence vaut
 * d'être expliquée : partager un PDF dont les annotations restent déplaçables
 * n'est pas la même chose que partager une page figée.
 */
const FORMATS = [
  {
    mode: "flat",
    icon: FileCheck2,
    label: "Aplati",
    hint: "Les annotations sont fondues dans la page. S'affiche à l'identique partout, et personne ne peut les déplacer. À privilégier pour partager.",
  },
  {
    mode: "annot",
    icon: FilePenLine,
    label: "Annotations conservées",
    hint: "Les traits restent des annotations Ink de la norme PDF, manipulables dans Acrobat ou Aperçu. Avec leur apparence incluse, pour s'afficher partout.",
  },
] as const;

export function ExportPdf({ noteId, disabled }: { noteId: string; disabled?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outlined" disabled={disabled} title="Exporter les pages manuscrites">
          <Download />
          PDF
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Exporter en PDF"
        description="Les pages manuscrites de cette note, document importé compris."
      >
        <ul className="space-y-2">
          {FORMATS.map(({ mode, icon: Icon, label, hint }) => (
            <li key={mode}>
              <a
                href={`/api/notes/${noteId}/pdf?mode=${mode}`}
                download
                className="state-layer flex items-start gap-4 rounded-2xl bg-surface-lowest p-4 transition-colors hover:bg-surface-container"
              >
                <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-on-primary-container">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block m3-title-small text-on-surface">{label}</span>
                  <span className="mt-0.5 block m3-body-small text-on-surface-variant">{hint}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-4 m3-body-small text-on-surface-variant">
          Le document d&apos;origine n&apos;est jamais modifié : ses pages sont copiées dans un
          nouveau fichier.
        </p>
      </DialogContent>
    </Dialog>
  );
}
