"use client";

import { Download, FileJson, FileSpreadsheet, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { ExportFormat } from "@/lib/export";

/**
 * Export de toutes les cartes du compte.
 *
 * Trois formats parce qu'ils ne servent pas la même chose, et le dire vaut
 * mieux que laisser choisir au hasard entre trois extensions.
 *
 * Des liens de téléchargement, et non un `fetch` suivi d'un `blob` : le
 * navigateur sait déjà nommer et ranger un fichier servi avec
 * `Content-Disposition`, et la page n'a pas à garder l'export en mémoire.
 */
const FORMATS: {
  format: ExportFormat;
  icon: React.ElementType;
  label: string;
  hint: string;
}[] = [
  {
    format: "json",
    icon: FileJson,
    label: "Sauvegarde complète",
    hint: "Paquets, dossiers, mise en forme. À garder pour tout restaurer.",
  },
  {
    format: "csv",
    icon: FileSpreadsheet,
    label: "Tableur",
    hint: "Une ligne par carte, à ouvrir dans Excel, Numbers ou Sheets.",
  },
  {
    format: "txt",
    icon: FileText,
    label: "Texte tabulé",
    hint: "Le format que relit l'import de l'app, et celui de Quizlet.",
  },
];

export function ExportDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outlined" size="lg">
          <Download />
          Exporter
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Exporter mes cartes"
        description="Toutes tes cartes, tous paquets confondus."
      >
        <ul className="space-y-2">
          {FORMATS.map(({ format, icon: Icon, label, hint }) => (
            <li key={format}>
              <a
                href={`/api/export?format=${format}`}
                // `download` demande l'enregistrement plutôt que l'affichage ;
                // le nom réel vient du serveur, qui sait le dater.
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
                <span className="mt-1 m3-label-small uppercase text-on-surface-variant">
                  .{format}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
