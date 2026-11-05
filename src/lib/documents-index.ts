import "server-only";

import { spawn } from "node:child_process";
import { setPriority } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { prisma } from "@/lib/prisma";
import { blockFiles } from "@/lib/notes";
import { lireMots, texteDePage, type MotLu } from "@/lib/recherche-document";
import { normalizeForSearch } from "@/lib/search";
import { isValidUploadName } from "@/lib/upload-path";
import { UPLOAD_DIR } from "@/lib/uploads";

/**
 * Lire les documents des notes, pour pouvoir y chercher.
 *
 * Une file, et un seul document lu à la fois : le travail est long — plusieurs
 * secondes par page scannée — et personne ne l'attend. Il tourne dans un processus
 * à part (`scripts/indexer-document.mjs`), à basse priorité : écrire dans une note
 * pendant ce temps reste fluide, et un PDF abîmé ne fait pas tomber le serveur.
 *
 * L'état vit en base, page après page : un redémarrage au milieu d'un polycopié
 * de deux cents pages reprend à la page où il en était.
 */

/** Tout ce qu'une page peut mettre avant qu'on la tienne pour bloquée. */
const DELAI_PAGE_MS = 180_000;

let enCours = false;

/**
 * Accorde la liste des documents d'une note à ses blocs.
 *
 * Appelée quand un fichier apparaît ou disparaît d'un bloc, jamais à chaque
 * enregistrement : elle relit tous les blocs de la note.
 */
export async function lierDocuments(noteId: string) {
  const blocs = await prisma.noteBlock.findMany({
    where: { noteId, kind: { in: ["drawing", "image"] } },
    select: { kind: true, content: true },
  });
  const voulus = new Set(
    blocs.flatMap((b) => blockFiles(b.kind, b.content)).filter((nom) => isValidUploadName(nom)),
  );

  const actuels = await prisma.noteDocument.findMany({ where: { noteId }, select: { file: true } });
  const deja = new Set(actuels.map((d) => d.file));
  const partis = [...deja].filter((nom) => !voulus.has(nom));
  const arrives = [...voulus].filter((nom) => !deja.has(nom));

  if (partis.length > 0) {
    await prisma.noteDocument.deleteMany({ where: { noteId, file: { in: partis } } });
  }
  for (const file of arrives) {
    await prisma.documentIndex.upsert({ where: { file }, create: { file }, update: {} });
    await prisma.noteDocument.create({ data: { noteId, file } });
  }
  if (arrives.length > 0) lancerIndexation();
}

/** Le fichier est parti du disque : ce qu'on en avait lu aussi. */
export async function oublierDocument(file: string) {
  await prisma.documentIndex.deleteMany({ where: { file } });
}

/** Enregistre une page lue. Le texte vient des mots, pour ne rien lire deux fois. */
async function enregistrerPage(file: string, page: number, mots: MotLu[], ocr: boolean) {
  const texte = texteDePage(mots);
  const donnees = {
    texte,
    searchText: normalizeForSearch(texte),
    mots: JSON.stringify(mots),
    ocr,
  };
  await prisma.documentPage.upsert({
    where: { file_page: { file, page } },
    create: { file, page, ...donnees },
    update: donnees,
  });
  await prisma.documentIndex.updateMany({ where: { file }, data: { lues: page } });
}

/** Lit un document, à partir de la page où l'on s'était arrêté. */
function lireDocument(file: string, depuis: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(/* turbopackIgnore: true */ process.cwd(), "scripts", "indexer-document.mjs");
    const chemin = path.join(/* turbopackIgnore: true */ UPLOAD_DIR, file);
    const fils = spawn(process.execPath, [script, chemin, String(depuis)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      if (fils.pid) setPriority(fils.pid, 10);
    } catch {
      // Refusé sur certains systèmes : la lecture sera seulement moins discrète.
    }

    let minuteur: ReturnType<typeof setTimeout>;
    const veiller = () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => fils.kill("SIGKILL"), DELAI_PAGE_MS);
    };
    veiller();

    let erreur = "";
    let termine = false;
    // Les lignes s'enregistrent dans l'ordre : `lues` ne doit jamais reculer.
    let attente: Promise<unknown> = Promise.resolve();

    createInterface({ input: fils.stdout }).on("line", (ligne) => {
      veiller();
      attente = attente.then(async () => {
        const message = JSON.parse(ligne) as {
          page?: number;
          ocr?: boolean;
          mots?: MotLu[];
          fin?: boolean;
          pages?: number;
          erreur?: string;
        };
        if (message.erreur) erreur = message.erreur;
        if (message.fin) {
          termine = true;
          await prisma.documentIndex.updateMany({ where: { file }, data: { pages: message.pages ?? 0 } });
        }
        if (message.page !== undefined) {
          await enregistrerPage(file, message.page, message.mots ?? [], message.ocr === true);
        }
      });
    });
    fils.stderr.resume();

    fils.on("error", reject);
    fils.on("close", () => {
      clearTimeout(minuteur);
      void attente.then(
        () => (termine ? resolve() : reject(new Error(erreur || "lecture interrompue"))),
        reject,
      );
    });
  });
}

/** Lance la file, si elle ne tourne pas déjà. Ne bloque jamais l'appelant. */
export function lancerIndexation() {
  if (enCours) return;
  enCours = true;
  void (async () => {
    try {
      for (;;) {
        const suivant = await prisma.documentIndex.findFirst({
          where: { statut: "attente" },
          orderBy: { createdAt: "asc" },
          select: { file: true, lues: true },
        });
        if (!suivant) return;
        const { file, lues } = suivant;
        await prisma.documentIndex.update({ where: { file }, data: { statut: "lecture" } });
        try {
          await lireDocument(file, lues + 1);
          await prisma.documentIndex.updateMany({ where: { file }, data: { statut: "fini", erreur: "" } });
        } catch (error) {
          const erreur = String((error as Error)?.message ?? error).slice(0, 300);
          console.error(`[documents] lecture de ${file} impossible :`, erreur);
          await prisma.documentIndex.updateMany({ where: { file }, data: { statut: "echec", erreur } });
        }
      }
    } catch (error) {
      console.error("[documents] file interrompue :", error);
    } finally {
      enCours = false;
    }
  })();
}

/**
 * Au démarrage : reprendre ce qui a été interrompu, et rattraper l'existant.
 *
 * Les documents importés avant cette version n'ont jamais été lus. Une note
 * portant un fichier mais aucun lien est donc reliée ici — une fois : ensuite
 * elle a ses liens et cette requête ne la voit plus.
 */
export async function reprendreIndexation() {
  await prisma.documentIndex.updateMany({ where: { statut: "lecture" }, data: { statut: "attente" } });
  const sansLien = await prisma.note.findMany({
    where: {
      documents: { none: {} },
      blocks: {
        some: {
          kind: { in: ["drawing", "image"] },
          OR: [{ content: { contains: '"file":"' } }, { content: { contains: '"image":"' } }],
        },
      },
    },
    select: { id: true },
  });
  for (const note of sansLien) await lierDocuments(note.id);
  lancerIndexation();
}

export type EtatLecture = { total: number; lus: number; enCours: boolean; echecs: number };

/** Où en est la lecture des documents d'une note, pour le dire dans la loupe. */
export async function etatLecture(noteId: string): Promise<EtatLecture> {
  const documents = await prisma.noteDocument.findMany({
    where: { noteId },
    select: { document: { select: { statut: true } } },
  });
  const statuts = documents.map((d) => d.document.statut);
  return {
    total: statuts.length,
    lus: statuts.filter((s) => s === "fini").length,
    enCours: statuts.some((s) => s === "attente" || s === "lecture"),
    echecs: statuts.filter((s) => s === "echec").length,
  };
}

/** Les pages d'un compte qui contiennent tous ces termes, avec les notes qui les portent. */
export async function pagesTrouvees(userId: string, termes: string[], limite = 200) {
  const pages = await prisma.documentPage.findMany({
    where: {
      AND: termes.map((mot) => ({ searchText: { contains: mot } })),
      document: { notes: { some: { note: { ownerId: userId } } } },
    },
    select: {
      file: true,
      page: true,
      texte: true,
      ocr: true,
      document: {
        select: { notes: { where: { note: { ownerId: userId } }, select: { noteId: true } } },
      },
    },
    orderBy: [{ file: "asc" }, { page: "asc" }],
    take: limite,
  });
  return pages;
}

/** Les notes d'un compte dont un document contient tous ces termes. */
export async function notesParDocuments(userId: string, termes: string[]): Promise<string[]> {
  const pages = await pagesTrouvees(userId, termes);
  return [...new Set(pages.flatMap((p) => p.document.notes.map((n) => n.noteId)))];
}

export { lireMots };
