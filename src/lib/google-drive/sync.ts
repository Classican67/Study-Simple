import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { paquetsDuCompte } from "@/lib/export-server";
import type { Backup } from "@/lib/export";
import { notePdf } from "@/lib/note-pdf";
import { blockFiles, contenusImprimables, parseDrawing, parseImageBlock, UNTITLED } from "@/lib/notes";
import { resolveUploadPath, contentTypeFor } from "@/lib/uploads";
import { ouvrir } from "@/lib/google-drive/coffre";
import { noteMarkdown } from "@/lib/google-drive/markdown";
import { nomDeFichier, planifier, RACINE, type Connu, type Voulu } from "@/lib/google-drive/plan";
import {
  configuration,
  creerDossier,
  envoyerFichier,
  ErreurGoogle,
  existe,
  jetonAcces,
  jeter,
  modifier,
  retrouver,
  type Configuration,
  type Etiquettes,
} from "@/lib/google-drive/google";

/**
 * La synchronisation d'un compte avec son Google Drive.
 *
 * Ce que l'on trouve dans le Drive, sous « Fiches » :
 *
 *     Fiches/
 *       LISEZMOI.txt
 *       Notes/                    ← l'arbre des dossiers de notes, tel quel
 *         Biologie/
 *           Cours 3.pdf           ← les pages manuscrites, annotations comprises
 *           Cours 3.md            ← le texte et les tableaux de la note
 *       Données/                  ← de quoi tout restaurer
 *         Paquets.json            ← le même fichier que « Sauvegarde complète »
 *         Dossiers.json
 *         Notes/<id>.json         ← chaque note, blocs bruts
 *         Fichiers/<nom>          ← polycopiés, photos, images des cartes
 *
 * Chaque passe ne renvoie que ce qui a changé ; une passe où rien n'a bougé
 * s'arrête à l'empreinte du compte (`signature`), sans relire une note.
 */

export type Bilan = { envoyes: number; deplaces: number; jetes: number; erreurs: string[] };

const enCours = new Set<string>();

export function estEnCours(userId: string): boolean {
  return enCours.has(userId);
}

/** Un fichier à produire : le contenu n'est calculé qu'au moment de l'envoyer. */
type AProduire = { mime: string; produire: () => Promise<Uint8Array | null> };

const MIME_JSON = "application/json";
const texte = (s: string) => new TextEncoder().encode(s);
const empreinte = (s: string) => createHash("sha256").update(s).digest("hex");

const LISEZMOI = `Sauvegarde de Fiches
=====================

Ce dossier est tenu à jour par l'application, environ une fois par heure.
Ne le renommez pas et n'y déplacez rien : l'application le reconnaît.

Notes/    Vos notes, rangées comme dans l'application.
          .pdf : les pages manuscrites et les documents annotés.
          .md  : le texte et les tableaux.

Données/  De quoi tout restaurer.
          Paquets.json  : vos paquets de cartes (même format que
                          « Sauvegarde complète » dans l'application).
          Dossiers.json : vos dossiers.
          Notes/        : chaque note, telle que l'application la garde.
          Fichiers/     : les documents, photos et images d'origine.

Un fichier supprimé dans l'application part dans la corbeille de Drive,
où il reste trente jours. Drive garde aussi l'historique des versions de
chaque fichier : clic droit, « Gérer les versions ».
`;

/** Ce qui doit se trouver dans le Drive, et de quoi le produire. */
async function inventaire(userId: string, connus: Map<string, Connu>) {
  const voulus: Voulu[] = [];
  const producteurs = new Map<string, AProduire>();
  const dossier = (key: string, name: string, parent: string) =>
    voulus.push({ key, name, parent, version: "", dossier: true });
  const fichier = (key: string, name: string, parent: string, version: string, a: AProduire) => {
    voulus.push({ key, name, parent, version, dossier: false });
    producteurs.set(key, a);
  };

  dossier(RACINE, "Fiches", "");
  dossier("notes", "Notes", RACINE);
  dossier("donnees", "Données", RACINE);
  dossier("donnees:notes", "Notes", "donnees");
  dossier("donnees:fichiers", "Fichiers", "donnees");
  fichier("lisezmoi", "LISEZMOI.txt", RACINE, empreinte(LISEZMOI), {
    mime: "text/plain",
    produire: async () => texte(LISEZMOI),
  });

  // --- Les dossiers de notes ---------------------------------------------
  const dossiers = await prisma.folder.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true, parentId: true, kind: true, color: true },
  });
  const dossiersDeNotes = new Set(dossiers.filter((d) => d.kind === "note").map((d) => d.id));
  const placeDe = (folderId: string | null) =>
    folderId && dossiersDeNotes.has(folderId) ? `folder:${folderId}` : "notes";
  for (const d of dossiers) {
    if (d.kind !== "note") continue;
    dossier(`folder:${d.id}`, nomDeFichier(d.name, "", "Dossier"), placeDe(d.parentId));
  }
  const dossiersJson = JSON.stringify(dossiers, null, 2);
  fichier("donnees:dossiers", "Dossiers.json", "donnees", empreinte(dossiersJson), {
    mime: MIME_JSON,
    produire: async () => texte(dossiersJson),
  });

  // --- Les paquets --------------------------------------------------------
  const paquets = await paquetsDuCompte(userId);
  const paquetsJson = JSON.stringify(paquets);
  fichier("donnees:paquets", "Paquets.json", "donnees", empreinte(paquetsJson), {
    mime: MIME_JSON,
    produire: async () => {
      const sauvegarde: Backup = { exportedAt: new Date().toISOString(), app: "fiches", version: 1, decks: paquets };
      return texte(JSON.stringify(sauvegarde, null, 2));
    },
  });
  const fichiersVoulus = new Set(
    paquets.flatMap((p) => p.cards.map((c) => c.imagePath)).filter((n): n is string => Boolean(n)),
  );

  // --- Les notes ----------------------------------------------------------
  const notes = await prisma.note.findMany({
    where: { ownerId: userId },
    select: { id: true, title: true, folderId: true, updatedAt: true },
  });
  for (const note of notes) {
    const version = note.updatedAt.toISOString();
    const titre = note.title.trim() || UNTITLED;
    const place = placeDe(note.folderId);

    const cle = (suffixe: string) => `note:${note.id}:${suffixe}`;
    const aJour = (key: string) => connus.get(key)?.version === version;
    const pdf = () => ({
      mime: "application/pdf",
      produire: async () => {
        const dessins = await prisma.noteBlock.findMany({
          where: { noteId: note.id, kind: { in: ["drawing", "image"] } },
          orderBy: { position: "asc" },
          select: { kind: true, content: true },
        });
        return notePdf(note.title, contenusImprimables(dessins), "flat");
      },
    });
    const markdown = (md: string | null) => ({
      mime: "text/markdown",
      produire: async () => {
        if (md !== null) return texte(md);
        const blocs = await prisma.noteBlock.findMany({
          where: { noteId: note.id },
          orderBy: { position: "asc" },
          select: { kind: true, content: true },
        });
        const relu = noteMarkdown(note.title, blocs);
        return relu ? texte(relu) : null;
      },
    });

    /*
     * Une note qui n'a pas bougé n'est pas relue : ses fichiers restent ce
     * qu'ils sont. C'est ce qui permet à une passe sur un compte de deux
     * cents notes de ne lire que celle qu'on vient de modifier — une page
     * dense pèse des centaines de kilooctets, un polycopié des dizaines de
     * mégaoctets.
     */
    if (aJour(`donnees:note:${note.id}`) && (aJour(cle("pdf")) || aJour(cle("md")))) {
      if (connus.has(cle("pdf"))) fichier(cle("pdf"), nomDeFichier(titre, ".pdf", "Note"), place, version, pdf());
      if (connus.has(cle("md"))) fichier(cle("md"), nomDeFichier(titre, ".md", "Note"), place, version, markdown(null));
    } else {
      // Neuve ou modifiée : lue une fois, pour savoir s'il y a des pages à
      // mettre en PDF, du texte à mettre en Markdown, et quels fichiers elle
      // désigne. Le PDF, lui, ne sera produit qu'au moment de l'envoyer.
      const blocs = await prisma.noteBlock.findMany({
        where: { noteId: note.id },
        orderBy: { position: "asc" },
        select: { kind: true, content: true },
      });
      for (const b of blocs) for (const nom of blockFiles(b.kind, b.content)) fichiersVoulus.add(nom);
      const pages = blocs.some((b) => {
        if (b.kind === "image") return Boolean(parseImageBlock(b.content).file);
        if (b.kind !== "drawing") return false;
        const d = parseDrawing(b.content);
        return d.strokes.length > 0 || d.pages.length > 0 || d.images.length > 0 || d.textes.length > 0;
      });
      const md = noteMarkdown(note.title, blocs);
      if (pages) fichier(cle("pdf"), nomDeFichier(titre, ".pdf", "Note"), place, version, pdf());
      if (md) fichier(cle("md"), nomDeFichier(titre, ".md", "Note"), place, version, markdown(md));
    }
    fichier(`donnees:note:${note.id}`, `${note.id}.json`, "donnees:notes", version, {
      mime: MIME_JSON,
      produire: async () => {
        const complete = await prisma.note.findUnique({
          where: { id: note.id },
          select: {
            id: true,
            title: true,
            folderId: true,
            mastered: true,
            format: true,
            createdAt: true,
            updatedAt: true,
            blocks: { orderBy: { position: "asc" }, select: { kind: true, position: true, content: true } },
          },
        });
        return complete ? texte(JSON.stringify(complete)) : null;
      },
    });
  }

  // --- Les fichiers d'origine ---------------------------------------------
  /*
   * Ceux des notes non relues : déjà déposés, et toujours désignés par un bloc
   * du compte ? C'est la base qui répond, sans rien transférer — la même
   * question que pose `nettoyerFichiers` avant d'effacer un fichier du disque.
   * Un fichier **neuf**, lui, ne peut venir que d'une note modifiée : il est
   * déjà dans la liste.
   */
  for (const connu of connus.values()) {
    if (!connu.key.startsWith("file:")) continue;
    const nom = connu.key.slice("file:".length);
    if (fichiersVoulus.has(nom)) continue;
    const encore = await prisma.noteBlock.count({
      where: { kind: { in: ["drawing", "image"] }, content: { contains: nom }, note: { ownerId: userId } },
    });
    if (encore > 0) fichiersVoulus.add(nom);
  }
  for (const nom of fichiersVoulus) {
    const chemin = resolveUploadPath(nom);
    if (!chemin) continue;
    // Un nom de fichier est un UUID : son contenu ne change jamais.
    fichier(`file:${nom}`, nom, "donnees:fichiers", nom, {
      mime: contentTypeFor(nom),
      produire: async () => readFile(chemin).catch(() => null),
    });
  }

  return { voulus, producteurs };
}

/**
 * L'empreinte de l'état d'un compte : ce qui, s'il ne bouge pas, dispense de
 * toute la passe. Dates de modification et comptes, rien de plus lourd.
 */
async function signatureDuCompte(userId: string): Promise<string> {
  const [notes, dossiers, paquets, cartes] = await Promise.all([
    prisma.note.findMany({ where: { ownerId: userId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    prisma.folder.findMany({ where: { ownerId: userId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    prisma.deck.findMany({ where: { ownerId: userId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    prisma.card.aggregate({ where: { deck: { ownerId: userId } }, _count: true, _max: { updatedAt: true } }),
  ]);
  const lignes = [
    ...notes.map((n) => `n${n.id}${n.updatedAt.getTime()}`),
    ...dossiers.map((d) => `d${d.id}${d.updatedAt.getTime()}`),
    ...paquets.map((p) => `p${p.id}${p.updatedAt.getTime()}`),
    `c${cartes._count}:${cartes._max.updatedAt?.getTime() ?? 0}`,
    // Le contenu du LISEZMOI fait partie de l'état : le changer doit repartir.
    empreinte(LISEZMOI),
  ];
  return empreinte(lignes.join("\n"));
}

/**
 * Retrouve la sauvegarde d'un compte d'après les étiquettes posées sur chaque
 * fichier — quand la table de correspondance est vide alors que le Drive, lui,
 * ne l'est pas : base restaurée, ou Drive délié puis relié.
 */
async function reconstituer(jeton: string, userId: string): Promise<Connu[]> {
  const trouves = await retrouver(jeton, userId);
  const cleDe = new Map(trouves.map((t) => [t.driveId, t.etiquettes.fichesCle ?? ""]));
  const connus: Connu[] = [];
  const vus = new Set<string>();
  for (const t of trouves) {
    const key = t.etiquettes.fichesCle;
    // Deux fichiers pour une même clé : on garde le premier, l'autre sera jeté
    // à la passe suivante comme n'importe quel orphelin.
    if (!key || vus.has(key)) continue;
    vus.add(key);
    connus.push({
      key,
      driveId: t.driveId,
      version: t.etiquettes.fichesVersion ?? "",
      name: t.name,
      parent: t.parentId ? (cleDe.get(t.parentId) ?? "") : "",
    });
  }
  return connus;
}

async function noter(userId: string, connu: Connu) {
  await prisma.driveItem.upsert({
    where: { userId_key: { userId, key: connu.key } },
    create: { userId, ...connu },
    update: { driveId: connu.driveId, version: connu.version, name: connu.name, parent: connu.parent },
  });
}

/**
 * Une passe de synchronisation. Rend `null` si le compte n'est pas relié, ou
 * si une passe est déjà en cours pour lui.
 *
 * `force` : passer outre l'empreinte — c'est le bouton « Sauvegarder
 * maintenant », qui doit au moins vérifier que le Drive est complet.
 */
export async function synchroniser(userId: string, options: { force?: boolean } = {}): Promise<Bilan | null> {
  const config = configuration();
  if (!config || enCours.has(userId)) return null;
  enCours.add(userId);
  try {
    return await passe(config, userId, options.force === true);
  } finally {
    enCours.delete(userId);
  }
}

async function passe(config: Configuration, userId: string, force: boolean): Promise<Bilan | null> {
  const lien = await prisma.driveLink.findUnique({ where: { userId } });
  if (!lien || lien.lastStatus === "reconnect") return null;
  const bilan: Bilan = { envoyes: 0, deplaces: 0, jetes: 0, erreurs: [] };

  const refresh = ouvrir(lien.refreshToken, process.env.SESSION_SECRET ?? "");
  if (!refresh) {
    await prisma.driveLink.updateMany({
      where: { userId },
      data: { lastStatus: "reconnect", lastError: "La clé du serveur a changé." },
    });
    return null;
  }

  const signature = await signatureDuCompte(userId);
  if (!force && lien.lastStatus === "ok" && lien.signature === signature) {
    await prisma.driveLink.updateMany({ where: { userId }, data: { lastSyncAt: new Date(), lastSent: 0 } });
    return bilan;
  }

  try {
    const jeton = await jetonAcces(config, userId, refresh);

    // --- Ce qu'on a déjà déposé ------------------------------------------
    let lignes: Connu[] = await prisma.driveItem.findMany({
      where: { userId },
      select: { key: true, driveId: true, version: true, name: true, parent: true },
    });
    const racine = lignes.find((l) => l.key === RACINE);
    // Le dossier « Fiches » mis à la corbeille ou supprimé : tout ce qu'on
    // croyait déposé est parti avec lui. On repart de ce qui reste.
    if (racine && !(await existe(jeton, racine.driveId))) {
      await prisma.driveItem.deleteMany({ where: { userId } });
      lignes = [];
    }
    if (lignes.length === 0) {
      lignes = await reconstituer(jeton, userId);
      for (const l of lignes) await noter(userId, l);
    }
    const connus = new Map(lignes.map((l) => [l.key, l]));

    // --- Ce qu'il faut y trouver -----------------------------------------
    const { voulus, producteurs } = await inventaire(userId, connus);
    const gestes = planifier(voulus, lignes);
    const ids = new Map(lignes.map((l) => [l.key, l.driveId]));
    const etiquettes = (v: Voulu): Etiquettes => ({ fichesCompte: userId, fichesCle: v.key, fichesVersion: v.version });

    for (const geste of gestes) {
      try {
        if (geste.type === "jeter") {
          await jeter(jeton, geste.connu.driveId).catch((error) => {
            // Déjà parti : c'est ce qu'on voulait.
            if (!(error instanceof ErreurGoogle && error.nature === "introuvable")) throw error;
          });
          await prisma.driveItem.deleteMany({ where: { userId, key: geste.connu.key } });
          bilan.jetes++;
          continue;
        }

        const v = geste.voulu;
        const parentId = v.parent ? (ids.get(v.parent) ?? null) : null;
        if (v.parent && !parentId) throw new Error(`dossier parent absent (${v.parent})`);
        const depot = { name: v.name, parentId, etiquettes: etiquettes(v) };
        const ancienParentId =
          geste.type === "creer" ? null : geste.connu.parent ? (ids.get(geste.connu.parent) ?? null) : null;

        let driveId: string;
        if (v.dossier) {
          if (geste.type === "creer") {
            driveId = await creerDossier(jeton, depot);
          } else {
            driveId = geste.connu.driveId;
            try {
              await modifier(jeton, driveId, depot, ancienParentId);
            } catch (error) {
              if (!(error instanceof ErreurGoogle && error.nature === "introuvable")) throw error;
              driveId = await creerDossier(jeton, depot);
            }
          }
          bilan.deplaces += geste.type === "creer" ? 0 : 1;
        } else if (geste.type === "deplacer") {
          driveId = geste.connu.driveId;
          try {
            await modifier(jeton, driveId, depot, ancienParentId);
            bilan.deplaces++;
          } catch (error) {
            if (!(error instanceof ErreurGoogle && error.nature === "introuvable")) throw error;
            driveId = await produireEtEnvoyer(jeton, producteurs.get(v.key), depot);
            bilan.envoyes++;
          }
        } else {
          const producteur = producteurs.get(v.key);
          try {
            driveId = await produireEtEnvoyer(
              jeton,
              producteur,
              depot,
              geste.type === "remplacer" ? { driveId: geste.connu.driveId, ancienParentId } : undefined,
            );
          } catch (error) {
            // Supprimé à la main dans Drive : on le recrée.
            if (!(geste.type === "remplacer" && error instanceof ErreurGoogle && error.nature === "introuvable")) {
              throw error;
            }
            driveId = await produireEtEnvoyer(jeton, producteur, depot);
          }
          bilan.envoyes++;
        }

        ids.set(v.key, driveId);
        await noter(userId, { key: v.key, driveId, version: v.version, name: v.name, parent: v.parent });
      } catch (error) {
        if (error instanceof ErreurGoogle && error.nature === "acces") throw error;
        if (error instanceof Rien) {
          // Rien à produire (une note vidée entre l'inventaire et l'envoi) : rien à déposer.
          continue;
        }
        const cle = geste.type === "jeter" ? geste.connu.key : geste.voulu.key;
        bilan.erreurs.push(`${cle} : ${(error as Error).message}`);
      }
    }

    await prisma.driveLink.updateMany({
      where: { userId },
      data: {
        lastSyncAt: new Date(),
        lastStatus: bilan.erreurs.length > 0 ? "error" : "ok",
        lastError: bilan.erreurs.slice(0, 3).join(" · ").slice(0, 500),
        lastSent: bilan.envoyes,
        // L'empreinte n'est retenue que si tout est passé : sinon la prochaine
        // passe doit réessayer ce qui a échoué.
        signature: bilan.erreurs.length > 0 ? "" : signature,
      },
    });
    return bilan;
  } catch (error) {
    const acces = error instanceof ErreurGoogle && error.nature === "acces";
    await prisma.driveLink.updateMany({
      where: { userId },
      data: {
        lastSyncAt: new Date(),
        lastStatus: acces ? "reconnect" : "error",
        lastError: acces
          ? "Google a retiré l'accès."
          : `${(error as Error).message}`.slice(0, 500),
        signature: "",
      },
    });
    if (!acces) console.error("[google-drive]", error);
    return { ...bilan, erreurs: [...bilan.erreurs, (error as Error).message] };
  }
}

class Rien extends Error {}

async function produireEtEnvoyer(
  jeton: string,
  producteur: AProduire | undefined,
  depot: { name: string; parentId: string | null; etiquettes: Etiquettes },
  existant?: { driveId: string; ancienParentId: string | null },
): Promise<string> {
  if (!producteur) throw new Error("rien pour produire ce fichier");
  const octets = await producteur.produire();
  if (!octets) throw new Rien();
  return envoyerFichier(jeton, { ...depot, mime: producteur.mime, octets }, existant);
}
