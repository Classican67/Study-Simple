"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deckSchema } from "@/lib/validation";

export type GroupResult =
  | { ok: true; deckId: string; created: number; skipped: number }
  | { ok: false; error: string };

/** Ce qu'on retient des paquets choisis. */
export type GroupFilter = "withImage" | "all";

/**
 * Compte, paquet par paquet, ce qui serait copié — sans rien écrire.
 *
 * Par paquet et non en total : c'est ce qui permet d'être sélectif. Sans ce
 * détail, on coche à l'aveugle sans savoir lesquels contiennent des figures.
 *
 * Un seul appel couvre tous les paquets à l'écran : le total se recalcule
 * ensuite côté client à chaque case cochée, sans aller-retour.
 */
export async function countByDeck(
  deckIds: string[],
  filter: GroupFilter,
): Promise<Record<string, number>> {
  const user = await requireUser();
  if (deckIds.length === 0) return {};

  const rows = await prisma.card.groupBy({
    by: ["deckId"],
    where: {
      deckId: { in: deckIds },
      deck: { ownerId: user.id },
      ...(filter === "withImage" ? { imagePath: { not: null } } : {}),
    },
    _count: { _all: true },
  });

  // Les paquets sans aucune carte correspondante sont absents du groupBy : on
  // les remet à zéro, pour que l'interface puisse les afficher quand même.
  const counts: Record<string, number> = Object.fromEntries(deckIds.map((id) => [id, 0]));
  for (const row of rows) counts[row.deckId] = row._count._all;
  return counts;
}

/**
 * Réunit dans un paquet les cartes de plusieurs autres, en les **dupliquant**.
 *
 * Le cas d'usage : rassembler toutes les figures anatomiques éparpillées dans
 * les paquets d'un cours pour les réviser ensemble.
 *
 * Ce sont de vraies copies, pas des références : on les modifie et on les
 * supprime librement, le paquet d'origine n'en sait rien. Seule la provenance
 * est notée, pour afficher d'où vient la carte et pour ne pas la reprendre
 * deux fois si l'on relance le regroupement.
 *
 * Un seul lien subsiste entre les deux, et il est invisible : le **nom de
 * fichier de l'image**, partagé. C'est pourquoi un fichier n'est effacé du
 * disque que lorsque plus aucune carte ne le référence.
 *
 * Le paquet cible peut être un paquet existant ou un paquet à créer. Les
 * cartes déjà présentes — même originale déjà reprise — sont ignorées : on
 * peut relancer le regroupement après avoir ajouté des cartes, sans doublons.
 */
export async function groupCards(input: {
  deckIds: string[];
  filter: GroupFilter;
  targetDeckId?: string | null;
  newDeckTitle?: string;
  folderId?: string | null;
}): Promise<GroupResult> {
  const user = await requireUser();

  const sources = await prisma.deck.findMany({
    where: { id: { in: input.deckIds }, ownerId: user.id },
    select: { id: true },
  });
  if (sources.length === 0) return { ok: false, error: "Aucun paquet source valide." };

  /*
   * On lit les cartes AVANT de toucher à la destination.
   *
   * L'ordre inverse laissait un paquet vide derrière lui dès que la suite
   * échouait — et c'est arrivé, sur un client Prisma périmé : l'utilisateur
   * s'est retrouvé avec un « Figures à réviser » fantôme. Rien n'est créé tant
   * qu'on ne sait pas qu'il y a quelque chose à copier.
   */
  const existingTarget = input.targetDeckId
    ? await prisma.deck.findFirst({
        where: { id: input.targetDeckId, ownerId: user.id },
        select: { id: true },
      })
    : null;
  if (input.targetDeckId && !existingTarget) {
    return { ok: false, error: "Paquet de destination introuvable." };
  }

  // Se copier soi-même n'aurait aucun sens et ferait des doublons en boucle.
  const sourceIds = sources.map((d) => d.id).filter((id) => id !== existingTarget?.id);
  if (sourceIds.length === 0) {
    return { ok: false, error: "Le paquet de destination ne peut pas être sa propre source." };
  }

  // Le titre est validé maintenant, lui aussi : mieux vaut le refuser avant
  // d'avoir lu des centaines de cartes pour rien.
  const parsedTitle = existingTarget
    ? null
    : deckSchema.safeParse({ title: input.newDeckTitle ?? "", description: "", color: "amber" });
  if (parsedTitle && !parsedTitle.success) {
    return { ok: false, error: parsedTitle.error.issues[0]?.message ?? "Titre invalide." };
  }

  const cards = await prisma.card.findMany({
    where: {
      deckId: { in: sourceIds },
      ...(input.filter === "withImage" ? { imagePath: { not: null } } : {}),
    },
    orderBy: [{ deckId: "asc" }, { position: "asc" }],
    select: {
      id: true,
      term: true,
      definition: true,
      imagePath: true,
      searchText: true,
      // Copier une copie ferait pointer la provenance sur une copie : on
      // remonte toujours à l'originale, pour que « déjà repris » reste juste.
      sourceCardId: true,
    },
  });
  if (cards.length === 0) return { ok: false, error: "Aucune carte ne correspond." };

  // Il y a de quoi copier : on peut créer la destination.
  const targetId =
    existingTarget?.id ??
    (
      await prisma.deck.create({
        data: {
          ownerId: user.id,
          title: parsedTitle!.data.title,
          description: "",
          color: parsedTitle!.data.color,
          folderId: input.folderId ?? null,
        },
        select: { id: true },
      })
    ).id;

  // Ce que le paquet cible contient déjà, par origine : relancer l'opération
  // après avoir ajouté des cartes ne doit pas créer de doublons.
  const existing = await prisma.card.findMany({
    where: { deckId: targetId },
    select: { id: true, sourceCardId: true },
  });
  const already = new Set(existing.map((c) => c.sourceCardId ?? c.id));

  const last = await prisma.card.findFirst({
    where: { deckId: targetId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  let position = (last?.position ?? -1) + 1;

  const toCreate = cards
    .map((card) => ({ card, origin: card.sourceCardId ?? card.id }))
    .filter(({ origin }) => !already.has(origin))
    // Deux paquets sources peuvent contenir un alias de la même originale.
    .filter(({ origin }, index, list) => list.findIndex((x) => x.origin === origin) === index);

  if (toCreate.length > 0) {
    await prisma.card.createMany({
      data: toCreate.map(({ card, origin }) => ({
        deckId: targetId,
        term: card.term,
        definition: card.definition,
        imagePath: card.imagePath,
        searchText: card.searchText,
        sourceCardId: origin,
        position: position++,
      })),
    });
    await prisma.deck.update({ where: { id: targetId }, data: { updatedAt: new Date() } });
  }

  revalidatePath("/");
  revalidatePath(`/decks/${targetId}`);
  if (input.folderId) revalidatePath(`/folders/${input.folderId}`);

  return {
    ok: true,
    deckId: targetId,
    created: toCreate.length,
    skipped: cards.length - toCreate.length,
  };
}
