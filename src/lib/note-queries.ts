import "server-only";

import { prisma } from "@/lib/prisma";
import { searchTerms } from "@/lib/search";

/**
 * Lectures de la section Notes : arborescence, listing et recherche.
 *
 * Les notes partagent l'arborescence des paquets — un cours a ses cartes et
 * ses notes, deux arbres obligeraient à ranger deux fois — mais la section a
 * sa propre vue : on n'y montre que les dossiers qui mènent à des notes.
 */

export type NoteSummary = {
  id: string;
  title: string;
  updatedAt: Date;
  kinds: string[];
};

export type NoteFolder = {
  id: string;
  name: string;
  color: string;
  /** Notes contenues, sous-dossiers compris : un dossier vide n'a rien à dire. */
  noteCount: number;
};

export type NotesView = {
  current: { id: string; name: string; color: string } | null;
  breadcrumb: { id: string; name: string }[];
  folders: NoteFolder[];
  notes: NoteSummary[];
  /** Nombre total de notes du compte, pour distinguer « vide » de « filtré ». */
  total: number;
};

export type NoteFilters = {
  /** Mots-clés. Vide = pas de filtre. */
  query?: string;
  /** Ne garder que les notes contenant ce type de bloc. */
  has?: "drawing" | "table" | "text" | null;
  /** Chercher dans toute l'arborescence plutôt que dans le dossier courant. */
  everywhere?: boolean;
};

export async function getNotesView(
  userId: string,
  folderId: string | null,
  filters: NoteFilters = {},
): Promise<NotesView | null> {
  const folders = await prisma.folder.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true, color: true, parentId: true },
    orderBy: { name: "asc" },
  });

  const current = folderId ? (folders.find((f) => f.id === folderId) ?? null) : null;
  // Dossier inexistant et dossier d'un autre compte donnent le même résultat.
  if (folderId && !current) return null;

  // Fil d'Ariane, en remontant les parents. Boucle bornée : un cycle dans
  // l'arbre ne doit pas figer la page.
  const breadcrumb: { id: string; name: string }[] = [];
  for (let cur = current, depth = 0; cur && depth < 64; depth++) {
    breadcrumb.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? (folders.find((f) => f.id === cur!.parentId) ?? null) : null;
  }

  const terms = searchTerms(filters.query ?? "");
  const cherche = terms.length > 0 || Boolean(filters.has);
  // Une recherche porte sur toute l'arborescence : chercher un mot et ne pas le
  // trouver parce qu'il est un dossier plus bas serait déroutant.
  const partout = filters.everywhere ?? cherche;

  const where = {
    ownerId: userId,
    ...(partout ? {} : { folderId }),
    ...(terms.length > 0
      ? { AND: terms.map((mot) => ({ searchText: { contains: mot } })) }
      : {}),
    ...(filters.has ? { blocks: { some: { kind: filters.has } } } : {}),
  };

  const [notes, total] = await Promise.all([
    prisma.note.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        // De quoi annoncer le contenu sans charger les blocs : un croquis pèse
        // des centaines de kilooctets.
        blocks: { select: { kind: true } },
      },
    }),
    prisma.note.count({ where: { ownerId: userId } }),
  ]);

  // Sous-dossiers du niveau courant, avec le nombre de notes qu'ils contiennent
  // en tout — sous-dossiers compris, sinon un dossier de rangement paraîtrait
  // vide alors qu'il mène quelque part.
  const enfants = folders.filter((f) => f.parentId === (folderId ?? null));
  const counts = await notesParSousArbre(userId, folders);

  return {
    current: current ? { id: current.id, name: current.name, color: current.color } : null,
    breadcrumb,
    folders: cherche
      ? []
      : enfants
          .map((f) => ({ id: f.id, name: f.name, color: f.color, noteCount: counts.get(f.id) ?? 0 }))
          // Un dossier sans la moindre note n'a rien à faire dans cette section.
          .filter((f) => f.noteCount > 0),
    notes: notes.map((note) => ({
      id: note.id,
      title: note.title,
      updatedAt: note.updatedAt,
      kinds: note.blocks.map((b) => b.kind),
    })),
    total,
  };
}

/** Nombre de notes par dossier, descendants compris. */
async function notesParSousArbre(
  userId: string,
  folders: { id: string; parentId: string | null }[],
): Promise<Map<string, number>> {
  const rows = await prisma.note.groupBy({
    by: ["folderId"],
    where: { ownerId: userId, folderId: { not: null } },
    _count: { _all: true },
  });

  const direct = new Map<string, number>();
  for (const row of rows) if (row.folderId) direct.set(row.folderId, row._count._all);

  const enfantsDe = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    enfantsDe.set(f.parentId, [...(enfantsDe.get(f.parentId) ?? []), f.id]);
  }

  const total = new Map<string, number>();
  const compte = (id: string, profondeur = 0): number => {
    if (profondeur > 64) return 0;
    const deja = total.get(id);
    if (deja !== undefined) return deja;
    let somme = direct.get(id) ?? 0;
    for (const enfant of enfantsDe.get(id) ?? []) somme += compte(enfant, profondeur + 1);
    total.set(id, somme);
    return somme;
  };
  for (const f of folders) compte(f.id);
  return total;
}

/** Dossiers proposés au rangement d'une note, avec leur chemin complet. */
export async function listNoteFolders(userId: string): Promise<{ id: string; path: string }[]> {
  const folders = await prisma.folder.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true, parentId: true },
    orderBy: { name: "asc" },
  });
  const byId = new Map(folders.map((f) => [f.id, f]));

  return folders
    .map((folder) => {
      const parts: string[] = [];
      for (let cur: string | null = folder.id, depth = 0; cur && depth < 64; depth++) {
        const f = byId.get(cur);
        if (!f) break;
        parts.unshift(f.name);
        cur = f.parentId;
      }
      return { id: folder.id, path: parts.join(" / ") };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "fr"));
}
