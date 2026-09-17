"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  CloudOff,
  CloudUpload,
  Folder as FolderIcon,
  GraduationCap,
  Keyboard,
  Layers,
  PartyPopper,
  RefreshCw,
  RotateCcw,
  Shuffle,
} from "lucide-react";

import { AnswerView } from "@/components/answer-view";
import { Logo } from "@/components/logo";
import { RichText, toPlainText } from "@/components/rich-text";
import { Badge, EmptyState, ProgressBar } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { useHorsLigne } from "@/components/hors-ligne/use-hors-ligne";
import { StudyClient } from "@/app/(app)/decks/[deckId]/study/study-client";
import { WriteClient } from "@/app/(app)/decks/[deckId]/study/write-client";
import { ModeSwitch } from "@/app/(app)/decks/[deckId]/study/mode-switch";
import { deckColor } from "@/lib/deck-colors";
import { descendantIds } from "@/lib/folder-tree";
import {
  lireNote,
  lirePaquet,
  lirePaquets,
  synchroniser,
  vider,
  type EtatHorsLigne,
  type ResumeNote,
  type ResumePaquet,
} from "@/lib/hors-ligne/client";
import { lienADetourner, lireDestination, type Destination } from "@/lib/hors-ligne/destination";
import {
  cleEpingle,
  estDue,
  type CarteHorsLigne,
  type NoteHorsLigne,
  type PaquetHorsLigne,
} from "@/lib/hors-ligne/modele";
import { NoteEditor } from "@/components/note/note-editor";
import { NoteThumbnail } from "@/components/note/note-thumbnail";
import { isBlockKind, parsePreview, UNTITLED, type BlockKind } from "@/lib/notes";
import { describeAgo } from "@/lib/scheduling";
import { DEFAULT_STUDY_ORDER, STUDY_ORDER_COOKIE, isStudyOrder, orderCards } from "@/lib/study-order";
import { DEFAULT_STUDY_SIDE, STUDY_SIDE_COOKIE, isStudySide } from "@/lib/study-side";
import { cn } from "@/lib/utils";

/**
 * Ce qui, de l'app, marche sans le serveur : les paquets et dossiers gardés
 * sur l'appareil, et leur révision.
 *
 * Les liens pointent vers les **vraies** adresses de l'app. Ils partent en
 * navigation complète : le service worker les renvoie ici tant que le serveur
 * ne répond pas, et vers la vraie page dès qu'il répond.
 */
export function Coquille() {
  const de = useSearchParams().get("de");
  const destination = React.useMemo(() => lireDestination(de), [de]);
  const etat = useHorsLigne();

  // Tout lien interne part en navigation complète — cf. `lienADetourner`.
  React.useEffect(() => {
    const clic = (evenement: MouseEvent) => {
      const lien = (evenement.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const cible = lienADetourner(evenement, lien, location.origin);
      if (!cible) return;
      evenement.preventDefault();
      location.assign(cible);
    };
    document.addEventListener("click", clic, true);
    // Le réseau revenu, tout repart : les réponses de révision, et la copie
    // des notes, pour que ce qui vient d'être envoyé ne manque pas à la
    // prochaine coupure.
    void vider();
    const enLigne = () => void synchroniser();
    window.addEventListener("online", enLigne);
    return () => {
      document.removeEventListener("click", clic, true);
      window.removeEventListener("online", enLigne);
    };
  }, []);

  if (!etat.charge) return <main className="min-h-dvh bg-surface" aria-busy="true" />;

  if (destination.vue === "revision") {
    return <Revision destination={destination} etat={etat} />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <Bandeau de={de} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
        {destination.vue === "paquet" ? (
          <VuePaquet id={destination.id} etat={etat} />
        ) : destination.vue === "dossier" ? (
          <VueDossier id={destination.id} etat={etat} />
        ) : destination.vue === "notes" ? (
          <VueNotes dossierId={destination.dossier} etat={etat} />
        ) : destination.vue === "note" ? (
          <VueNote id={destination.id} etat={etat} />
        ) : (
          <Accueil etat={etat} indisponible={destination.indisponible} />
        )}
      </main>
    </div>
  );
}

// --- Bandeau -------------------------------------------------------------------

function Bandeau({ de }: { de: string | null }) {
  const [essai, setEssai] = React.useState<"repos" | "encours" | "echec">("repos");

  async function reessayer() {
    setEssai("encours");
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      if (r.ok) {
        location.replace(de && de.startsWith("/") && !de.startsWith("//") ? de : "/");
        return;
      }
    } catch {
      // Toujours pas de serveur.
    }
    setEssai("echec");
  }

  return (
    <header className="pt-safe sticky top-0 z-40 bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <Link
          href="/"
          className="state-layer -mx-2 flex min-h-12 items-center gap-2.5 rounded-full px-2 text-on-surface"
          aria-label="Accueil hors ligne"
        >
          <Logo variant="mark" className="size-7" />
          <span className="m3-title-medium">Fiches</span>
        </Link>

        <span
          className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-secondary-container px-3 py-1.5 m3-label-large text-on-secondary-container"
          data-testid="statut-hors-ligne"
        >
          <CloudOff className="size-4" aria-hidden />
          Hors ligne
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="text" onClick={reessayer} disabled={essai === "encours"} className="px-4">
            <RefreshCw className={cn(essai === "encours" && "animate-spin")} aria-hidden />
            {essai === "echec" ? "Toujours hors ligne" : "Réessayer"}
          </Button>
        </div>
      </div>
    </header>
  );
}

// --- Accueil -------------------------------------------------------------------

function Accueil({ etat, indisponible }: { etat: EtatHorsLigne; indisponible: string | null }) {
  const paquets = [...etat.paquets.values()];
  const dues = paquets.reduce((n, p) => n + p.dues, 0);

  const notes = [...etat.notes.values()];

  const dossiersEpingles = etat.dossiers.filter((d) => etat.epingles.has(cleEpingle("dossier", d.id)));
  // Un dossier épinglé à l'intérieur d'un autre dossier épinglé est déjà
  // montré par son parent : l'afficher deux fois ferait croire à deux copies.
  const couverts = new Set(
    dossiersEpingles.flatMap((d) => descendantIds([...etat.dossiers], d.id).filter((id) => id !== d.id)),
  );
  const dossiers = dossiersEpingles.filter((d) => !couverts.has(d.id));
  const dansUnDossier = new Set(dossiers.flatMap((d) => descendantIds([...etat.dossiers], d.id)));
  const seuls = paquets.filter((p) => !p.folderId || !dansUnDossier.has(p.folderId));
  const notesSeules = notes.filter((n) => !n.folderId || !dansUnDossier.has(n.folderId));
  const dossiersDePaquets = dossiers.filter((d) => d.kind === "deck");
  const dossiersDeNotes = dossiers.filter((d) => d.kind === "note");
  const rien = paquets.length === 0 && notes.length === 0;

  return (
    <div className="space-y-8">
      {indisponible ? (
        <p
          className="flex items-start gap-3 rounded-xl bg-surface-container p-4 m3-body-medium text-on-surface-variant"
          data-testid="page-indisponible"
        >
          <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden />
          Cette page a besoin du serveur. Voici ce qui est gardé sur cet appareil.
        </p>
      ) : null}

      <header>
        <h1 className="text-pretty m3-display-small">Sur cet appareil</h1>
        <p className="mt-2 m3-body-large text-on-surface-variant">
          {rien ? "Rien n'est encore gardé hors ligne." : `${decompte(paquets.length, notes.length)} sans réseau.`}
        </p>
      </header>

      {etat.enAttente > 0 ? <EnAttente nombre={etat.enAttente} /> : null}

      {rien ? (
        <EmptyState
          icon={<CloudOff className="size-6" />}
          title="Rien n'est gardé sur cet appareil"
          description="Quand le serveur répond, touche « Garder hors ligne » sous le titre d'un paquet, d'une note ou d'un dossier — ou dans leur menu. Ils resteront consultables ici, et ce que tu y fais partira au retour du réseau."
        />
      ) : (
        <>
          {dues > 0 ? (
            <Link
              href="/study"
              className="group flex items-center gap-4 rounded-xl border border-primary/25 bg-primary-container p-5 elevation-1 transition-all hover:-translate-y-0.5 hover:elevation-2"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-on-primary elevation-1">
                <CalendarClock className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold text-on-surface">
                  {dues} carte{dues > 1 ? "s" : ""} à réviser aujourd&apos;hui
                </span>
                <span className="block m3-body-medium text-on-surface-variant">
                  Parmi les paquets gardés sur l&apos;appareil.
                </span>
              </span>
              <ArrowRight className="size-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : null}

          {dossiersDePaquets.length > 0 ? (
            <ListeDossiers titre="Dossiers de paquets" dossiers={dossiersDePaquets} etat={etat} />
          ) : null}
          {seuls.length > 0 ? <GrillePaquets titre="Paquets" paquets={seuls} /> : null}
          {dossiersDeNotes.length > 0 ? (
            <ListeDossiersNotes titre="Dossiers de notes" dossiers={dossiersDeNotes} etat={etat} />
          ) : null}
          {notesSeules.length > 0 ? <GrilleNotes titre="Notes" notes={notesSeules} /> : null}
        </>
      )}
    </div>
  );
}

function decompte(paquets: number, notes: number): string {
  const parties = [
    paquets > 0 ? `${paquets} paquet${paquets > 1 ? "s" : ""}` : null,
    notes > 0 ? `${notes} note${notes > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  return `${parties.join(" et ")} disponible${paquets + notes > 1 ? "s" : ""}`;
}

function EnAttente({ nombre }: { nombre: number }) {
  return (
    <p
      className="flex items-center gap-3 rounded-xl bg-secondary-container p-4 m3-body-medium text-on-secondary-container"
      data-testid="bandeau-en-attente"
    >
      <CloudUpload className="size-5 shrink-0" aria-hidden />
      {nombre === 1
        ? "Une réponse est gardée sur l'appareil : elle partira au retour du réseau."
        : `${nombre} réponses sont gardées sur l'appareil : elles partiront au retour du réseau.`}
    </p>
  );
}

// --- Dossier -------------------------------------------------------------------

/** Paquets gardés dans le sous-arbre d'un dossier. */
function paquetsDuSousArbre(etat: EtatHorsLigne, dossierId: string): ResumePaquet[] {
  const ids = new Set(descendantIds([...etat.dossiers], dossierId));
  return [...etat.paquets.values()].filter((p) => p.folderId && ids.has(p.folderId));
}

function VueDossier({ id, etat }: { id: string; etat: EtatHorsLigne }) {
  const dossier = etat.dossiers.find((d) => d.id === id);
  const sousArbre = dossier ? paquetsDuSousArbre(etat, id) : [];
  if (!dossier || sousArbre.length === 0) return <Accueil etat={etat} indisponible={`/folders/${id}`} />;

  const enfants = etat.dossiers.filter((d) => d.parentId === id && paquetsDuSousArbre(etat, d.id).length > 0);
  const ici = sousArbre.filter((p) => p.folderId === id);
  const dues = sousArbre.reduce((n, p) => n + p.dues, 0);
  const parent = dossier.parentId ? etat.dossiers.find((d) => d.id === dossier.parentId) : null;

  return (
    <div className="space-y-8">
      <Retour href={parent ? `/folders/${parent.id}` : "/"} libelle={parent ? parent.name : "Sur cet appareil"} />
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-1 grid size-11 shrink-0 place-items-center rounded-2xl text-white elevation-1"
            style={{ backgroundColor: deckColor(dossier.color) }}
          >
            <FolderIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-pretty m3-display-small">{dossier.name}</h1>
            <p className="mt-2 m3-body-large text-on-surface-variant">
              {sousArbre.length} paquet{sousArbre.length > 1 ? "s" : ""} gardé{sousArbre.length > 1 ? "s" : ""} hors
              ligne.
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href={`/folders/${id}/study`}>
            <Shuffle />
            {dues > 0 ? `Réviser (${dues})` : "Réviser le dossier"}
          </Link>
        </Button>
      </header>

      {etat.enAttente > 0 ? <EnAttente nombre={etat.enAttente} /> : null}
      {enfants.length > 0 ? <ListeDossiers titre="Dossiers" dossiers={enfants} etat={etat} /> : null}
      {ici.length > 0 ? <GrillePaquets titre={enfants.length > 0 ? "Paquets" : null} paquets={ici} /> : null}
    </div>
  );
}

function ListeDossiers({
  titre,
  dossiers,
  etat,
}: {
  titre: string;
  dossiers: readonly { id: string; name: string; color: string }[];
  etat: EtatHorsLigne;
}) {
  return (
    <section className="space-y-3">
      <h2 className="m3-title-small uppercase tracking-widest text-on-surface-variant">{titre}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dossiers.map((dossier) => {
          const paquets = paquetsDuSousArbre(etat, dossier.id);
          const dues = paquets.reduce((n, p) => n + p.dues, 0);
          return (
            <li key={dossier.id}>
              <Link
                href={`/folders/${dossier.id}`}
                className="group flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container p-4 elevation-1 transition-all hover:-translate-y-0.5 hover:border-outline hover:elevation-2"
              >
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl text-white elevation-1"
                  style={{ backgroundColor: deckColor(dossier.color) }}
                >
                  <FolderIcon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{dossier.name}</span>
                  <span className="block m3-body-small text-on-surface-variant">
                    {paquets.length} paquet{paquets.length > 1 ? "s" : ""}
                  </span>
                </span>
                {dues > 0 ? (
                  <Badge tone="accent" className="shrink-0">
                    {dues}
                  </Badge>
                ) : null}
                <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GrillePaquets({ titre, paquets }: { titre: string | null; paquets: ResumePaquet[] }) {
  return (
    <section className="space-y-3">
      {titre ? (
        <h2 className="m3-title-small uppercase tracking-widest text-on-surface-variant">{titre}</h2>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[...paquets]
          .sort((a, b) => a.title.localeCompare(b.title, "fr"))
          .map((paquet) => {
            const couleur = deckColor(paquet.color);
            return (
              <li key={paquet.id}>
                <Link
                  href={`/decks/${paquet.id}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container p-5 elevation-1 transition-all hover:-translate-y-1 hover:border-outline hover:elevation-2"
                  data-testid="paquet-hors-ligne"
                >
                  <span className="mb-4 flex items-start justify-between gap-3">
                    <span
                      className="grid size-11 shrink-0 place-items-center rounded-2xl text-white elevation-1"
                      style={{ backgroundColor: couleur }}
                    >
                      <Layers className="size-5" />
                    </span>
                    <Badge tone={paquet.dues > 0 ? "accent" : "success"}>
                      {paquet.dues > 0 ? `${paquet.dues} à réviser` : paquet.nbCartes > 0 ? "À jour" : "Vide"}
                    </Badge>
                  </span>
                  <span className="text-pretty text-lg font-semibold leading-snug">{toPlainText(paquet.title)}</span>
                  <span className="mt-auto pt-5">
                    <span className="mb-2 flex items-center gap-1.5 m3-body-small tabular-nums text-on-surface-variant">
                      {paquet.sues}/{paquet.nbCartes} carte{paquet.nbCartes > 1 ? "s" : ""}
                      <CircleCheck className="size-4 text-primary" aria-label="Disponible hors ligne" />
                    </span>
                    <ProgressBar
                      value={paquet.nbCartes === 0 ? 0 : (paquet.sues / paquet.nbCartes) * 100}
                      tint={couleur}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

// --- Paquet --------------------------------------------------------------------

function usePaquet(id: string) {
  const [paquet, setPaquet] = React.useState<PaquetHorsLigne | null | undefined>(undefined);
  React.useEffect(() => {
    let vivant = true;
    void lirePaquet(id).then((p) => vivant && setPaquet(p ?? null));
    return () => {
      vivant = false;
    };
  }, [id]);
  return paquet;
}

function VuePaquet({ id, etat }: { id: string; etat: EtatHorsLigne }) {
  const paquet = usePaquet(id);
  if (paquet === undefined) return null;
  if (paquet === null) return <Accueil etat={etat} indisponible={`/decks/${id}`} />;

  const dues = paquet.cartes.filter((c) => estDue(c)).length;
  const sues = paquet.cartes.filter((c) => c.status === "known").length;
  const dossier = paquet.folderId ? etat.dossiers.find((d) => d.id === paquet.folderId) : null;
  const dossierGarde = dossier && paquetsDuSousArbre(etat, dossier.id).length > 0;

  return (
    <div className="space-y-8">
      <div>
        <Retour
          href={dossierGarde ? `/folders/${dossier.id}` : "/"}
          libelle={dossierGarde ? dossier.name : "Sur cet appareil"}
        />
        <div className="mt-3 flex min-w-0 items-start gap-3.5">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-2xl text-white elevation-1"
            style={{ backgroundColor: deckColor(paquet.color) }}
          >
            <Layers className="size-5.5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-pretty m3-headline-medium">{paquet.title}</h1>
            {paquet.description ? (
              <p className="mt-1.5 text-sm leading-relaxed text-on-surface-variant">{paquet.description}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container p-5 elevation-1 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={dues > 0 ? "accent" : "neutral"}>{dues > 0 ? `${dues} à réviser` : "Rien à réviser"}</Badge>
            <Badge tone="success">
              {sues} sue{sues > 1 ? "s" : ""} sur {paquet.cartes.length}
            </Badge>
          </div>
          {paquet.cartes.length > 0 ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
              <Button asChild size="lg" className="flex-1 sm:flex-none">
                <Link href={`/decks/${paquet.id}/study`}>
                  <GraduationCap />
                  {dues > 0 ? `Réviser (${dues})` : "Réviser"}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outlined" className="flex-1 sm:flex-none">
                <Link href={`/decks/${paquet.id}/study?mode=write`}>
                  <Keyboard />
                  Écrire
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
        <ProgressBar
          value={paquet.cartes.length === 0 ? 0 : (sues / paquet.cartes.length) * 100}
          className="mt-5"
        />
      </div>

      {etat.enAttente > 0 ? <EnAttente nombre={etat.enAttente} /> : null}

      <section className="space-y-3">
        <h2 className="m3-title-small uppercase tracking-widest text-on-surface-variant">
          {paquet.cartes.length} carte{paquet.cartes.length > 1 ? "s" : ""}
        </h2>
        <ol className="space-y-3">
          {paquet.cartes.map((carte) => (
            <li key={carte.id} className="rounded-xl bg-surface-container p-4 sm:p-5" data-testid="carte-hors-ligne">
              <RichText className="font-semibold">{carte.term}</RichText>
              <AnswerView compact definition={carte.definition} imagePath={carte.imagePath} className="mt-2" />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Retour({ href, libelle }: { href: string; libelle: string }) {
  return (
    <Link
      href={href}
      className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 m3-body-medium text-on-surface-variant transition-colors hover:text-on-surface"
    >
      <ArrowLeft className="size-4" />
      {libelle}
    </Link>
  );
}

// --- Notes ---------------------------------------------------------------------

function notesDuSousArbre(etat: EtatHorsLigne, dossierId: string): ResumeNote[] {
  const ids = new Set(descendantIds([...etat.dossiers], dossierId));
  return [...etat.notes.values()].filter((n) => n.folderId && ids.has(n.folderId));
}

function VueNotes({ dossierId, etat }: { dossierId: string | null; etat: EtatHorsLigne }) {
  const dossier = dossierId ? etat.dossiers.find((d) => d.id === dossierId && d.kind === "note") : null;
  if (!dossier) return <Accueil etat={etat} indisponible={null} />;

  const sousArbre = notesDuSousArbre(etat, dossier.id);
  if (sousArbre.length === 0) return <Accueil etat={etat} indisponible={`/notes?folder=${dossier.id}`} />;

  const enfants = etat.dossiers.filter((d) => d.parentId === dossier.id && notesDuSousArbre(etat, d.id).length > 0);
  const ici = sousArbre.filter((n) => n.folderId === dossier.id);
  const parent = dossier.parentId ? etat.dossiers.find((d) => d.id === dossier.parentId) : null;
  const parentGarde = parent && notesDuSousArbre(etat, parent.id).length > 0;

  return (
    <div className="space-y-8">
      <Retour
        href={parentGarde ? `/notes?folder=${parent.id}` : "/"}
        libelle={parentGarde ? parent.name : "Sur cet appareil"}
      />
      <header className="flex min-w-0 items-start gap-3">
        <span
          className="mt-1 grid size-11 shrink-0 place-items-center rounded-2xl text-white elevation-1"
          style={{ backgroundColor: deckColor(dossier.color) }}
        >
          <FolderIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-pretty m3-display-small">{dossier.name}</h1>
          <p className="mt-2 m3-body-large text-on-surface-variant">
            {sousArbre.length} note{sousArbre.length > 1 ? "s" : ""} gardée{sousArbre.length > 1 ? "s" : ""} hors ligne.
          </p>
        </div>
      </header>
      {enfants.length > 0 ? <ListeDossiersNotes titre="Dossiers" dossiers={enfants} etat={etat} /> : null}
      {ici.length > 0 ? <GrilleNotes titre={enfants.length > 0 ? "Notes" : null} notes={ici} /> : null}
    </div>
  );
}

function ListeDossiersNotes({
  titre,
  dossiers,
  etat,
}: {
  titre: string;
  dossiers: readonly { id: string; name: string; color: string }[];
  etat: EtatHorsLigne;
}) {
  return (
    <section className="space-y-3">
      <h2 className="m3-title-small uppercase tracking-widest text-on-surface-variant">{titre}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dossiers.map((dossier) => {
          const n = notesDuSousArbre(etat, dossier.id).length;
          return (
            <li key={dossier.id}>
              <Link
                href={`/notes?folder=${dossier.id}`}
                className="group flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container p-4 elevation-1 transition-all hover:-translate-y-0.5 hover:border-outline hover:elevation-2"
              >
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl text-white elevation-1"
                  style={{ backgroundColor: deckColor(dossier.color) }}
                >
                  <FolderIcon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{dossier.name}</span>
                  <span className="block m3-body-small text-on-surface-variant">
                    {n} note{n > 1 ? "s" : ""}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GrilleNotes({ titre, notes }: { titre: string | null; notes: ResumeNote[] }) {
  return (
    <section className="space-y-3">
      {titre ? (
        <h2 className="m3-title-small uppercase tracking-widest text-on-surface-variant">{titre}</h2>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...notes]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((note) => (
            <li key={note.id}>
              <Link
                href={`/notes/${note.id}`}
                className="state-layer flex h-full flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container elevation-1 transition-all hover:-translate-y-0.5 hover:elevation-2"
                data-testid="note-hors-ligne"
              >
                <NoteThumbnail
                  preview={parsePreview(note.preview)}
                  className="aspect-[4/3] w-full border-b border-outline-variant"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                  <span className="block truncate m3-title-small text-on-surface">
                    {note.title.trim() || UNTITLED}
                  </span>
                  <span className="flex items-center gap-1.5 m3-body-small text-on-surface-variant">
                    Modifiée {describeAgo(new Date(note.updatedAt))}
                    <CircleCheck className="size-4 text-primary" aria-label="Disponible hors ligne" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}

function VueNote({ id, etat }: { id: string; etat: EtatHorsLigne }) {
  const [note, setNote] = React.useState<NoteHorsLigne | null | undefined>(undefined);
  React.useEffect(() => {
    let vivant = true;
    void lireNote(id).then((n) => vivant && setNote(n ?? null));
    return () => {
      vivant = false;
    };
  }, [id]);

  if (note === undefined) return null;
  if (note === null) return <Accueil etat={etat} indisponible={`/notes/${id}`} />;

  const dossier = note.folderId ? etat.dossiers.find((d) => d.id === note.folderId) : null;
  const dossierGarde = dossier && notesDuSousArbre(etat, dossier.id).length > 0;

  return (
    <div className="space-y-4">
      <Retour
        href={dossierGarde ? `/notes?folder=${dossier.id}` : "/"}
        libelle={dossierGarde ? dossier.name : "Sur cet appareil"}
      />
      <p
        className="flex items-start gap-3 rounded-xl bg-surface-container p-4 m3-body-medium text-on-surface-variant"
        data-testid="note-hors-ligne-avis"
      >
        <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden />
        Tu peux lire et écrire dans les blocs de cette note : tout part au retour du réseau. Ajouter, déplacer ou
        supprimer un bloc attendra le serveur.
      </p>
      <NoteEditor
        noteId={note.id}
        initialTitle={note.title}
        initialBlocks={note.blocs
          .filter((b) => isBlockKind(b.kind))
          .map((b) => ({ id: b.id, kind: b.kind as BlockKind, content: b.content }))}
        noteModifiee={note.updatedAt}
        horsLigne
      />
    </div>
  );
}

// --- Révision ------------------------------------------------------------------

function cookie(nom: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${nom}=`))
    ?.slice(nom.length + 1);
}

type Session = {
  titre: string;
  retour: string;
  rejouer: string;
  deckId: string | null;
  cartes: CarteHorsLigne[];
  toutes: number;
};

function Revision({
  destination,
  etat,
}: {
  destination: Extract<Destination, { vue: "revision" }>;
  etat: EtatHorsLigne;
}) {
  const [session, setSession] = React.useState<Session | null | undefined>(undefined);
  const { portee, tout, ecrire } = destination;

  // Lue une fois : la file de révision ne doit pas se reconstruire — ni se
  // remélanger — à chaque réponse qui modifie l'appareil.
  const cle = JSON.stringify(destination);
  React.useEffect(() => {
    let vivant = true;
    void (async () => {
      let paquets: PaquetHorsLigne[] = [];
      let titre = "la révision du jour";
      let retour = "/";
      let rejouer = "/study";
      let deckId: string | null = null;

      if (portee.genre === "paquet") {
        const p = await lirePaquet(portee.id);
        if (p) {
          paquets = [p];
          titre = p.title;
          retour = `/decks/${p.id}`;
          rejouer = `/decks/${p.id}/study?all=1`;
          deckId = p.id;
        }
      } else if (portee.genre === "dossier") {
        const dossier = etat.dossiers.find((d) => d.id === portee.id);
        const ids = new Set(dossier ? descendantIds([...etat.dossiers], dossier.id) : []);
        paquets = (await lirePaquets()).filter((p) => p.folderId && ids.has(p.folderId));
        titre = dossier?.name ?? "";
        retour = `/folders/${portee.id}`;
        rejouer = `/folders/${portee.id}/study?all=1`;
      } else {
        paquets = await lirePaquets();
      }

      const cartes = paquets.flatMap((p) => p.cartes);
      if (!vivant) return;
      if (cartes.length === 0) return setSession(null);
      const toutes = portee.genre !== "jour" && tout;
      setSession({
        titre,
        retour,
        rejouer,
        deckId,
        cartes: toutes ? cartes : cartes.filter((c) => estDue(c)),
        toutes: cartes.length,
      });
    })();
    return () => {
      vivant = false;
    };
    // `etat.dossiers` est lu à l'ouverture seulement, volontairement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  if (session === undefined) return <main className="min-h-dvh bg-surface" aria-busy="true" />;

  if (session === null) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface">
        <Bandeau de={null} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
          <Accueil etat={etat} indisponible="revision" />
        </main>
      </div>
    );
  }

  if (session.cartes.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface">
        <Bandeau de={null} />
        <main className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-8">
          <EmptyState
            icon={<PartyPopper className="size-6" />}
            title="Rien à réviser pour l'instant"
            description="Toutes ces cartes sont planifiées pour plus tard. Tu peux quand même tout repasser dès maintenant."
            action={
              <div className="flex w-full flex-col gap-2 sm:flex-row">
                <Button asChild variant="outlined">
                  <Link href={session.retour}>Retour</Link>
                </Button>
                {portee.genre !== "jour" ? (
                  <Button asChild>
                    <Link href={session.rejouer}>
                      <RotateCcw />
                      Tout revoir
                    </Link>
                  </Button>
                ) : null}
              </div>
            }
          />
        </main>
      </div>
    );
  }

  return <Seance session={session} ecrire={ecrire && portee.genre === "paquet"} tout={tout} />;
}

function Seance({ session, ecrire, tout }: { session: Session; ecrire: boolean; tout: boolean }) {
  const [reglages] = React.useState(() => {
    const ordre = cookie(STUDY_ORDER_COOKIE);
    const sens = cookie(STUDY_SIDE_COOKIE);
    const order = isStudyOrder(ordre) ? ordre : DEFAULT_STUDY_ORDER;
    return {
      order,
      side: isStudySide(sens) ? sens : DEFAULT_STUDY_SIDE,
      // Mélangées une fois pour toutes à l'ouverture de la séance.
      cartes: orderCards(session.cartes, order),
    };
  });

  const commun = {
    deckId: session.deckId,
    title: session.titre,
    backHref: session.retour,
    cards: reglages.cartes,
    deckOrder: session.cartes.map((c) => c.id),
    order: reglages.order,
    side: reglages.side,
  };
  const choixDuMode = session.deckId ? (
    <ModeSwitch base={`/decks/${session.deckId}/study`} all={tout} write={ecrire} />
  ) : undefined;

  return ecrire ? (
    <WriteClient
      {...commun}
      cardsHref={`/decks/${session.deckId}/study${tout ? "?all=1" : ""}`}
      extraOptions={choixDuMode}
    />
  ) : (
    <StudyClient {...commun} replayHref={session.rejouer} extraOptions={choixDuMode} />
  );
}
