import "server-only";

import { prisma } from "@/lib/prisma";
import type { ExportDeck } from "@/lib/export";

/**
 * Les paquets d'un compte, prêts à exporter.
 *
 * Partagé par le téléchargement (`/api/export`) et la sauvegarde Google
 * Drive : deux copies de cette requête finiraient par ne plus produire le
 * même fichier, et la sauvegarde ne se relirait plus comme un export.
 *
 * Le cloisonnement tient à `ownerId` : on n'exporte jamais que ce qui
 * appartient au compte demandé.
 */
export async function paquetsDuCompte(userId: string): Promise<ExportDeck[]> {
  const decks = await prisma.deck.findMany({
    where: { ownerId: userId },
    orderBy: [{ folderId: "asc" }, { title: "asc" }],
    select: {
      title: true,
      description: true,
      color: true,
      folderId: true,
      cards: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { term: true, definition: true, imagePath: true },
      },
    },
  });

  // Chemin complet de chaque dossier, « Sciences / Biologie » : sans lui, un
  // export de deux dossiers homonymes serait ambigu à la relecture.
  const folders = await prisma.folder.findMany({
    // L'export porte sur les paquets : seuls leurs dossiers ont un chemin à
    // reconstituer.
    where: { ownerId: userId, kind: "deck" },
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string | null): string => {
    const parts: string[] = [];
    // Une boucle bornée : un cycle dans l'arbre ne doit pas figer la requête.
    for (let cur = id, depth = 0; cur && depth < 64; depth++) {
      const folder = byId.get(cur);
      if (!folder) break;
      parts.unshift(folder.name);
      cur = folder.parentId;
    }
    return parts.join(" / ");
  };

  return decks.map((deck) => ({
    title: deck.title,
    description: deck.description,
    color: deck.color,
    folder: pathOf(deck.folderId),
    cards: deck.cards,
  }));
}
