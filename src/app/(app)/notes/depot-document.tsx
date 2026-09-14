"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";

import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/upload-path";
import { cn } from "@/lib/utils";

/**
 * Déposer un document sur la liste des notes pour l'importer.
 *
 * C'est le geste qui manquait : on a un polycopié dans Fichiers, on veut
 * l'annoter, et il faut aujourd'hui créer une note puis aller le chercher au
 * travers d'un sélecteur. Ici on le fait glisser sur la liste, et il se range
 * **là où l'on regarde** — dans le dossier ouvert.
 *
 * Sur iPad, c'est le seul chemin qui existe. Safari ne sait pas faire d'une
 * application web la destination d'une feuille de partage ni d'un « Ouvrir
 * avec » ; le glisser-déposer depuis Fichiers, lui, fonctionne depuis
 * iPadOS 15 — en écran partagé ou en Slide Over — et accepte justement le PDF
 * et les documents Word. Le manifeste déclare les deux autres pour Android,
 * ChromeOS et les navigateurs de bureau.
 *
 * Les écouteurs sont posés sur la **fenêtre** et non sur une zone dessinée :
 * on vise la liste dans son ensemble, et un rectangle à atteindre au doigt
 * avec un fichier au bout du doigt est une épreuve d'adresse inutile.
 */

/** Extensions acceptées, tirées de ce que le serveur sait convertir. */
const EXTENSIONS = Object.values(DOCUMENT_TYPES);

function accepte(file: File): boolean {
  if (file.type in DOCUMENT_TYPES) return true;
  // iOS n'annonce pas toujours de type : on se rabat sur l'extension, et le
  // serveur revérifie les octets.
  const point = file.name.lastIndexOf(".");
  return point !== -1 && EXTENSIONS.includes(file.name.slice(point).toLowerCase());
}

export function DepotDocument({
  folderId,
  nomDossier,
  children,
}: {
  folderId: string | null;
  /** Nom du dossier ouvert, pour dire où le document atterrira. */
  nomDossier?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [survol, setSurvol] = React.useState(false);
  const [encours, setEncours] = React.useState<{ fait: number; total: number } | null>(null);
  const [erreurLocale, setErreur] = React.useState<string | null>(null);

  /*
   * La feuille de partage renvoie ici avec son message quand elle échoue :
   * c'est une navigation, elle n'a pas d'autre moyen de se faire entendre.
   *
   * Lu pendant le rendu plutôt que recopié dans un état par un effet : ce
   * message **est** dans l'adresse, et le dupliquer obligerait à les tenir
   * synchronisés pour rien.
   */
  const erreur = erreurLocale ?? params.get("import");

  const importer = React.useCallback(
    async (files: File[]) => {
      const bons = files.filter(accepte);
      if (bons.length === 0) {
        setErreur("Seuls les PDF et les documents Word peuvent devenir des notes.");
        return;
      }
      const lourd = bons.find((f) => f.size > MAX_DOCUMENT_BYTES);
      if (lourd) {
        setErreur(
          `« ${lourd.name} » dépasse ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo.`,
        );
        return;
      }

      setErreur(null);
      setEncours({ fait: 0, total: bons.length });
      let dernier: string | null = null;
      for (const [index, file] of bons.entries()) {
        const data = new FormData();
        data.set("document", file);
        try {
          const reponse = await fetch(
            `/api/notes/import${folderId ? `?dossier=${encodeURIComponent(folderId)}` : ""}`,
            { method: "POST", body: data },
          );
          const charge = await reponse.json().catch(() => ({}));
          if (!reponse.ok) {
            setErreur(charge.error ?? `L'import de « ${file.name} » a échoué.`);
            break;
          }
          dernier = charge.noteId ?? null;
        } catch {
          setErreur("Connexion perdue pendant l'import.");
          break;
        }
        setEncours({ fait: index + 1, total: bons.length });
      }
      setEncours(null);
      router.refresh();
      // Un seul document : on l'ouvre, c'est ce qu'on venait faire. Plusieurs :
      // on reste sur la liste, où ils viennent d'apparaître.
      if (bons.length === 1 && dernier) router.push(`/notes/${dernier}`);
    },
    [folderId, router],
  );

  React.useEffect(() => {
    // Un glissement de fichier, et non le déplacement d'une note dans un
    // dossier — celui-là passe par les Pointer Events, pas par cette API.
    const fichiers = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    let profondeur = 0;
    const entrer = (event: DragEvent) => {
      if (!fichiers(event)) return;
      profondeur++;
      setSurvol(true);
    };
    const survoler = (event: DragEvent) => {
      if (!fichiers(event)) return;
      // Sans ce refus, le navigateur ouvre le PDF à la place de nous le donner.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const sortir = (event: DragEvent) => {
      if (!fichiers(event)) return;
      // Le compteur est nécessaire : `dragleave` se déclenche aussi en passant
      // d'un élément à son voisin, et le voile clignoterait.
      profondeur = Math.max(0, profondeur - 1);
      if (profondeur === 0) setSurvol(false);
    };
    const deposer = (event: DragEvent) => {
      if (!fichiers(event)) return;
      event.preventDefault();
      profondeur = 0;
      setSurvol(false);
      void importer(Array.from(event.dataTransfer?.files ?? []));
    };

    window.addEventListener("dragenter", entrer);
    window.addEventListener("dragover", survoler);
    window.addEventListener("dragleave", sortir);
    window.addEventListener("drop", deposer);
    return () => {
      window.removeEventListener("dragenter", entrer);
      window.removeEventListener("dragover", survoler);
      window.removeEventListener("dragleave", sortir);
      window.removeEventListener("drop", deposer);
    };
  }, [importer]);

  /*
   * « Ouvrir avec » : le fichier arrive par la file de lancement.
   *
   * C'est le pendant de `file_handlers` dans le manifeste. Inexistant sur iOS,
   * disponible sur les navigateurs de bureau à base de Chromium.
   */
  React.useEffect(() => {
    const file = window as unknown as {
      launchQueue?: { setConsumer: (c: (p: { files: FileSystemFileHandle[] }) => void) => void };
    };
    if (!file.launchQueue) return;
    file.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const recus = await Promise.all(params.files.map((h) => h.getFile()));
      void importer(recus);
    });
  }, [importer]);

  return (
    <div className="relative">
      {children}

      {erreur ? (
        <p role="alert" className="mt-4 m3-body-medium text-error">
          {erreur}
        </p>
      ) : null}

      {/* Le voile ne prend les événements de personne : il ne fait que dire ce
          qui va se passer. C'est la fenêtre qui reçoit le dépôt. */}
      {survol || encours ? (
        <div
          aria-hidden={!encours}
          role={encours ? "status" : undefined}
          className={cn(
            "pointer-events-none fixed inset-0 z-50 grid place-items-center p-6",
            "bg-surface/80 backdrop-blur-sm",
          )}
        >
          <div className="grid max-w-sm gap-3 rounded-3xl border-2 border-dashed border-primary bg-surface-container px-8 py-10 text-center elevation-3">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-container text-on-primary-container">
              {encours ? <Loader2 className="size-6 animate-spin" /> : <FileUp className="size-6" />}
            </span>
            <p className="m3-title-medium text-on-surface">
              {encours
                ? encours.total > 1
                  ? `Import ${encours.fait} sur ${encours.total}…`
                  : "Import du document…"
                : "Déposer pour en faire une note"}
            </p>
            <p className="m3-body-medium text-on-surface-variant">
              {encours
                ? "Le document devient une page annotable par page."
                : nomDossier
                  ? `Le document sera rangé dans « ${nomDossier} ».`
                  : "PDF ou document Word."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
