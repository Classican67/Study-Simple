import "server-only";

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { descendantIds } from "@/lib/folder-tree";
import { blockFiles, isBlockKind } from "@/lib/notes";
import type { CarteHorsLigne, DossierHorsLigne, NoteHorsLigne, PaquetHorsLigne } from "@/lib/hors-ligne/modele";

export type DemandeSynchro = {
  paquets: string[];
  dossiers: string[];
  notes: string[];
  /** Ce que l'appareil a déjà, par paquet. */
  versions: Record<string, string>;
};

export type PaquetSynchro = Omit<PaquetHorsLigne, "cartes"> & {
  /** Absentes quand la version de l'appareil est déjà la bonne. */
  cartes?: CarteHorsLigne[];
};

/** Une note n'est jamais renvoyée entière ici : cf. `noteHorsLigne`. */
export type NoteSynchro = Omit<NoteHorsLigne, "blocs" | "fichiers">;

export type ReponseSynchro = {
  userId: string;
  dossiers: DossierHorsLigne[];
  paquets: PaquetSynchro[];
  notes: NoteSynchro[];
  /** Épingles qui ne désignent plus rien : supprimé, ou d'un autre compte. */
  disparus: { paquets: string[]; dossiers: string[]; notes: string[] };
};

/**
 * Résout les épingles de l'appareil et rend ce qui a changé.
 *
 * Un seul aller-retour : l'appareil dit ce qu'il a, le serveur ne renvoie les
 * cartes que des paquets dont l'empreinte diffère. Réviser un paquet ailleurs
 * change ses échéances, donc son empreinte — c'est voulu.
 */
export async function synchroniser(userId: string, demande: DemandeSynchro): Promise<ReponseSynchro> {
  const lus = await prisma.folder.findMany({
    where: { ownerId: userId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, parentId: true, kind: true },
  });
  const dossiers: DossierHorsLigne[] = lus.map((d) => ({ ...d, kind: d.kind === "note" ? "note" : "deck" }));
  const dossiersConnus = new Set(dossiers.map((d) => d.id));

  const dossiersEpingles = demande.dossiers.filter((id) => dossiersConnus.has(id));
  const sousArbres = new Set(dossiersEpingles.flatMap((id) => descendantIds(dossiers, id)));

  const paquets = await prisma.deck.findMany({
    where: {
      ownerId: userId,
      OR: [{ id: { in: demande.paquets } }, { folderId: { in: [...sousArbres] } }],
    },
    orderBy: { title: "asc" },
    select: {
      id: true,
      folderId: true,
      title: true,
      description: true,
      color: true,
      cards: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          term: true,
          definition: true,
          imagePath: true,
          progress: {
            where: { userId },
            select: { status: true, streak: true, dueAt: true, lastSeenAt: true },
          },
        },
      },
    },
  });
  const paquetsTrouves = new Set(paquets.map((p) => p.id));

  // Les notes : métadonnées seulement. Leur contenu pèse jusqu'à plusieurs
  // mégaoctets par page manuscrite ; il descend note par note, et seulement
  // pour celles dont la version a changé.
  const notes = await prisma.note.findMany({
    where: {
      ownerId: userId,
      OR: [{ id: { in: demande.notes } }, { folderId: { in: [...sousArbres] } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      folderId: true,
      title: true,
      mastered: true,
      preview: true,
      updatedAt: true,
      blocks: { orderBy: { position: "asc" }, select: { id: true } },
    },
  });
  const notesTrouvees = new Set(notes.map((n) => n.id));

  return {
    userId,
    dossiers,
    paquets: paquets.map((paquet) => {
      const cartes: CarteHorsLigne[] = paquet.cards.map((carte) => {
        const p = carte.progress[0];
        return {
          id: carte.id,
          term: carte.term,
          definition: carte.definition,
          imagePath: carte.imagePath,
          status: p?.status ?? "new",
          streak: p?.streak ?? 0,
          dueAt: p?.dueAt?.getTime() ?? null,
          lastSeenAt: p?.lastSeenAt?.getTime() ?? null,
        };
      });
      const meta = {
        id: paquet.id,
        folderId: paquet.folderId,
        title: paquet.title,
        description: paquet.description,
        color: paquet.color,
      };
      const version = createHash("sha1").update(JSON.stringify([meta, cartes])).digest("base64url");
      return demande.versions[paquet.id] === version ? { ...meta, version } : { ...meta, version, cartes };
    }),
    notes: notes.map((note) => ({
      id: note.id,
      folderId: note.folderId,
      title: note.title,
      mastered: note.mastered,
      preview: note.preview,
      updatedAt: note.updatedAt.getTime(),
      version: versionNote(note),
    })),
    disparus: {
      paquets: demande.paquets.filter((id) => !paquetsTrouves.has(id)),
      dossiers: demande.dossiers.filter((id) => !dossiersConnus.has(id)),
      notes: demande.notes.filter((id) => !notesTrouvees.has(id)),
    },
  };
}

/**
 * Empreinte d'une note, sans lire le contenu de ses blocs.
 *
 * Toute écriture de bloc repousse `updatedAt` (`touch`) ; « maîtrisée », elle,
 * le préserve exprès pour ne pas bousculer le tri, et le titre ou le dossier
 * peuvent changer sans toucher aux blocs. Les quatre entrent donc dans
 * l'empreinte, avec l'ordre des blocs.
 */
function versionNote(note: {
  preview: string;
  updatedAt: Date;
  title: string;
  mastered: boolean;
  folderId: string | null;
  blocks: { id: string }[];
}): string {
  return createHash("sha1")
    .update(
      JSON.stringify([
        note.updatedAt.getTime(),
        note.title,
        note.mastered,
        note.folderId,
        note.preview,
        note.blocks.map((b) => b.id),
      ]),
    )
    .digest("base64url");
}

/** Une note entière, telle que l'appareil la garde. */
export async function noteHorsLigne(userId: string, noteId: string): Promise<NoteHorsLigne | null> {
  const note = await prisma.note.findFirst({
    where: { id: noteId, ownerId: userId },
    select: {
      id: true,
      folderId: true,
      title: true,
      mastered: true,
      preview: true,
      updatedAt: true,
      blocks: { orderBy: { position: "asc" }, select: { id: true, kind: true, content: true } },
    },
  });
  if (!note) return null;
  // Un type de bloc inconnu vient d'une version plus récente : ignoré, comme
  // le fait la page de la note.
  const blocs = note.blocks.filter((b) => isBlockKind(b.kind));
  return {
    id: note.id,
    folderId: note.folderId,
    title: note.title,
    mastered: note.mastered,
    preview: note.preview,
    updatedAt: note.updatedAt.getTime(),
    version: versionNote(note),
    blocs,
    fichiers: [...new Set(blocs.flatMap((b) => blockFiles(b.kind, b.content)))],
  };
}

/**
 * Tout ce que le build sert sous `/_next/static/`, plus le worker de pdf.js.
 *
 * La page hors ligne ne cite dans son HTML que les scripts de son premier
 * affichage. Ceux qu'on charge à la demande — pdf.js, qu'une note importée
 * appelle — n'y figurent pas, et manqueraient donc hors ligne au premier
 * polycopié ouvert. Le build entier pèse moins de deux
 * mégaoctets ; le garder tout entier est ce que font les PWA ordinaires.
 */
export async function ressourcesDuBuild(): Promise<string[]> {
  const racine = path.join(/* turbopackIgnore: true */ process.cwd(), ".next", "static");
  const fichiers: string[] = [];
  async function parcourir(dossier: string) {
    for (const entree of await readdir(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) await parcourir(chemin);
      else fichiers.push(`/_next/static/${path.relative(racine, chemin).split(path.sep).map(encodeURIComponent).join("/")}`);
    }
  }
  try {
    await parcourir(racine);
  } catch {
    // Serveur de dev : pas de build, et pas de service worker non plus.
    return [];
  }
  return [...fichiers, "/pdf.worker.min.mjs"];
}
