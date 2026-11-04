import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, CloudOff, ExternalLink, HardDriveUpload, Unlink } from "lucide-react";

import { Badge, Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ExportDialog } from "@/components/export-dialog";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { configuration } from "@/lib/google-drive/google";
import { RACINE } from "@/lib/google-drive/plan";
import { estEnCours } from "@/lib/google-drive/sync";
import { delierDrive, sauvegarderMaintenant } from "./actions";
import { BoutonSauvegarder, SuivrePasse } from "./rafraichir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sauvegarde" };

/** Ce que dit l'adresse au retour de Google, en une phrase. */
const RETOURS: Record<string, { ton: "success" | "danger"; texte: string }> = {
  relie: { ton: "success", texte: "Google Drive est relié. La première sauvegarde est en cours." },
  refuse: { ton: "danger", texte: "Google n'a pas donné l'accès. Rien n'a été relié." },
  expire: { ton: "danger", texte: "La demande a expiré ou ne venait pas de cette page. Recommence." },
  erreur: { ton: "danger", texte: "La liaison a échoué du côté de Google. Réessaie dans un instant." },
  config: { ton: "danger", texte: "La sauvegarde Google Drive n'est pas configurée sur ce serveur." },
};

function ilYa(date: Date): string {
  const secondes = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const abs = Math.abs(secondes);
  if (abs < 60) return rtf.format(secondes, "second");
  if (abs < 3600) return rtf.format(Math.round(secondes / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secondes / 3600), "hour");
  return rtf.format(Math.round(secondes / 86400), "day");
}

export default async function SauvegardePage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const user = await requireUser();
  const { drive } = await searchParams;
  const retour = drive ? RETOURS[drive] : undefined;
  const configure = configuration() !== null;
  const lien = await prisma.driveLink.findUnique({ where: { userId: user.id } });
  const racine = lien
    ? await prisma.driveItem.findUnique({ where: { userId_key: { userId: user.id, key: RACINE } } })
    : null;
  const fichiers = lien ? await prisma.driveItem.count({ where: { userId: user.id } }) : 0;
  const enCours = estEnCours(user.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="m3-headline-medium">Sauvegarde</h1>
        <p className="mt-1 m3-body-medium text-on-surface-variant">
          Une copie de tes paquets et de tes notes, hors de ce serveur.
        </p>
      </div>

      {retour ? (
        <p
          role="status"
          className={
            retour.ton === "success"
              ? "rounded-xl bg-success-container px-4 py-3 text-on-success-container"
              : "rounded-xl bg-error-container px-4 py-3 text-on-error-container"
          }
        >
          {retour.texte}
        </p>
      ) : null}

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <HardDriveUpload className="size-6 text-primary" aria-hidden />
          <h2 className="m3-title-large">Google Drive</h2>
          {lien ? (
            lien.lastStatus === "reconnect" ? (
              <Badge tone="danger">À relier</Badge>
            ) : (
              <Badge tone="success">Relié</Badge>
            )
          ) : null}
        </div>

        {!configure ? (
          <div className="space-y-2 m3-body-medium text-on-surface-variant">
            <p>La sauvegarde vers Google Drive n&apos;est pas encore configurée sur ce serveur.</p>
            {user.role === "admin" ? (
              <p>
                Il faut un identifiant OAuth Google : renseigne <code>GOOGLE_CLIENT_ID</code>,{" "}
                <code>GOOGLE_CLIENT_SECRET</code> et <code>GOOGLE_REDIRECT_URI</code> dans{" "}
                <code>.env</code>, puis redémarre l&apos;app. Les étapes sont dans le README, section
                « Sauvegarde Google Drive ».
              </p>
            ) : (
              <p>Demande à l&apos;administrateur de l&apos;activer.</p>
            )}
          </div>
        ) : !lien ? (
          <div className="space-y-4">
            <ul className="list-disc space-y-1 pl-5 m3-body-medium text-on-surface-variant">
              <li>Un dossier « Fiches » dans ton Drive, tenu à jour environ une fois par heure.</li>
              <li>Chaque note en PDF avec ses annotations, et son texte à côté.</li>
              <li>Tes paquets et tes fichiers d&apos;origine, de quoi tout restaurer.</li>
              <li>L&apos;app ne voit que ce dossier : rien d&apos;autre de ton Drive.</li>
            </ul>
            <Button asChild>
              {/* Une navigation, pas un appel : la personne part chez Google. */}
              <a href="/api/google-drive/connexion">
                <HardDriveUpload />
                Relier Google Drive
              </a>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <SuivrePasse enCours={enCours} />
            <p className="m3-body-medium">
              Compte : <span className="font-medium">{lien.email || "compte Google"}</span>
            </p>

            <div className="flex items-start gap-2 m3-body-medium" aria-live="polite">
              {enCours ? (
                <p className="text-on-surface-variant">Sauvegarde en cours…</p>
              ) : lien.lastStatus === "reconnect" ? (
                <>
                  <CloudOff className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />
                  <p>
                    {lien.lastError || "Google a retiré l'accès."} Rien n&apos;est plus envoyé tant
                    que le Drive n&apos;est pas relié à nouveau.
                  </p>
                </>
              ) : lien.lastStatus === "error" ? (
                <>
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />
                  <p>
                    La dernière sauvegarde ({lien.lastSyncAt ? ilYa(lien.lastSyncAt) : "—"}) n&apos;est
                    pas complète : {lien.lastError}. La prochaine passe réessaiera.
                  </p>
                </>
              ) : lien.lastSyncAt ? (
                <>
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                  <p>
                    À jour — dernière vérification {ilYa(lien.lastSyncAt)}, {fichiers} élément
                    {fichiers > 1 ? "s" : ""} dans le Drive.
                  </p>
                </>
              ) : (
                <p className="text-on-surface-variant">Première sauvegarde en attente.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {lien.lastStatus === "reconnect" ? (
                <Button asChild>
                  <a href="/api/google-drive/connexion">
                    <HardDriveUpload />
                    Relier à nouveau
                  </a>
                </Button>
              ) : (
                <form action={sauvegarderMaintenant}>
                  <BoutonSauvegarder enCours={enCours} />
                </form>
              )}
              {racine ? (
                <Button variant="outlined" asChild>
                  <a
                    href={`https://drive.google.com/drive/folders/${encodeURIComponent(racine.driveId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink />
                    Ouvrir dans Drive
                  </a>
                </Button>
              ) : null}
              <ConfirmDialog
                trigger={
                  <Button variant="text">
                    <Unlink />
                    Délier
                  </Button>
                }
                title="Délier Google Drive ?"
                description="L'app n'enverra plus rien. Les fichiers déjà sauvegardés restent dans ton Drive ; les relier plus tard les retrouvera."
                confirmLabel="Délier"
                action={delierDrive}
              />
            </div>
          </div>
        )}
      </Panel>

      <Panel className="space-y-3">
        <h2 className="m3-title-large">Télécharger une copie</h2>
        <p className="m3-body-medium text-on-surface-variant">
          Les paquets, dans un fichier à garder où tu veux. Chaque note s&apos;exporte en PDF depuis
          son menu.
        </p>
        <ExportDialog />
      </Panel>
    </div>
  );
}
