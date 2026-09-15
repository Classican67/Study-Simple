import "server-only";

import { prisma } from "@/lib/prisma";
import { parsePreview, UNTITLED, type NotePreview } from "@/lib/notes";
import { searchTerms } from "@/lib/search";
import { folderPaths, type FolderNode } from "@/lib/folder-tree";

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
  preview: NotePreview;
  folderId: string | null;
  /** Marquée « maîtrisée » par la personne. */
  mastered: boolean;
};

/** Ordre d'affichage des notes. */
export const NOTE_SORTS = ["updated", "created", "title"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

export function isNoteSort(value: unknown): value is NoteSort {
  return typeof value === "string" && (NOTE_SORTS as readonly string[]).includes(value);
}

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
  /** Toute l'arborescence des notes : les menus en tirent destinations et chemins. */
  tree: FolderNode[];
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
  /** Ordre d'affichage. Par défaut, la dernière modifiée d'abord. */
  sort?: NoteSort;
};

export async function getNotesView(
  userId: string,
  folderId: string | null,
  filters: NoteFilters = {},
): Promise<NotesView | null> {
  const folders = await prisma.folder.findMany({
    // Seuls les dossiers de notes : les paquets ont leur propre classement.
    where: { ownerId: userId, kind: "note" },
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
      /*
       * Le tri par titre est fait après coup, en mémoire.
       *
       * SQLite compare les chaînes octet par octet : « Écrite » se retrouve
       * après « Note », parce que « É » s'encode sur deux octets dont le
       * premier vaut plus que « N ». Aucune collation française n'est
       * disponible sans extension. Le listing étant borné à deux cents notes,
       * trier ici coûte moins qu'installer ICU.
       */
      orderBy: filters.sort === "created" ? { createdAt: "desc" } : { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        folderId: true,
        mastered: true,
        // L'aperçu est une copie compacte, enregistrée avec la note : on ne
        // charge jamais le contenu des blocs pour dessiner une vignette.
        preview: true,
        // De quoi annoncer le contenu sans charger les blocs : une page
        // manuscrite pèse des centaines de kilooctets.
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

  /*
   * Les notes sans titre vont à la fin.
   *
   * Une liste alphabétique ne s'interrompt pas au milieu par un tas de « Note
   * sans titre » : ce ne sont pas des noms, ce sont des notes qu'on n'a pas
   * encore nommées.
   */
  const ordonnees =
    filters.sort === "title"
      ? [...notes].sort((a, b) =>
          (a.title.trim() || "\uffff").localeCompare(b.title.trim() || "\uffff", "fr", {
            sensitivity: "base",
            numeric: true,
          }),
        )
      : notes;

  return {
    current: current ? { id: current.id, name: current.name, color: current.color } : null,
    breadcrumb,
    tree: folders,
    // Tous les sous-dossiers du niveau, même vides : on doit pouvoir créer un
    // dossier depuis cette section puis y déposer une note. Les masquer tant
    // qu'ils sont vides les ferait disparaître à la création.
    folders: cherche
      ? []
      : enfants.map((f) => ({
          id: f.id,
          name: f.name,
          color: f.color,
          noteCount: counts.get(f.id) ?? 0,
        })),
    notes: ordonnees.map((note) => ({
      id: note.id,
      title: note.title,
      updatedAt: note.updatedAt,
      kinds: note.blocks.map((b) => b.kind),
      folderId: note.folderId,
      mastered: note.mastered,
      preview: parsePreview(note.preview),
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

/** L'arborescence des dossiers de notes, à plat. */
export async function noteFolderTree(userId: string): Promise<FolderNode[]> {
  return prisma.folder.findMany({
    where: { ownerId: userId, kind: "note" },
    select: { id: true, name: true, color: true, parentId: true },
    orderBy: { name: "asc" },
  });
}

/** Dossiers proposés au rangement d'une note, avec leur chemin complet. */
export async function listNoteFolders(userId: string): Promise<{ id: string; path: string }[]> {
  return folderPaths(await noteFolderTree(userId));
}

/** Une note trouvée par la recherche globale. */
export type NoteSearchResult = {
  noteId: string;
  title: string;
  folder: string | null;
  excerpt: string;
};

/**
 * Recherche des notes par mots, dans tout le compte.
 *
 * Même principe que pour les cartes : la base filtre grossièrement sur
 * `searchText`, déjà normalisé, et l'extrait est découpé ensuite autour du
 * premier mot trouvé — c'est ce qui permet de reconnaître la bonne note sans
 * l'ouvrir.
 */
export async function searchNotes(userId: string, query: string): Promise<NoteSearchResult[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const notes = await prisma.note.findMany({
    where: {
      ownerId: userId,
      AND: terms.map((mot) => ({ searchText: { contains: mot } })),
    },
    select: {
      id: true,
      title: true,
      searchText: true,
      folder: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });

  return notes.map((note) => ({
    noteId: note.id,
    title: note.title.trim() || UNTITLED,
    folder: note.folder?.name ?? null,
    excerpt: extrait(note.searchText, terms[0]),
  }));
}

/** Quelques mots autour de la première occurrence, pour situer la note. */
function extrait(texte: string, mot: string, largeur = 90): string {
  const at = texte.indexOf(mot);
  if (at === -1) return texte.slice(0, largeur);
  const debut = Math.max(0, at - Math.floor(largeur / 3));
  return (debut > 0 ? "…" : "") + texte.slice(debut, debut + largeur).trim() + "…";
}
