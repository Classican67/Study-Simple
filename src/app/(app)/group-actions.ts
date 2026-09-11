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
 * Compte ce qui serait repris, sans rien écrire.
 * Sert à annoncer « 23 cartes » avant de valider : constituer un paquet de
 * révision à l'aveugle n'inspire pas confiance.
 */
export async function countGroupable(
  deckIds: string[],
  filter: GroupFilter,
): Promise<number> {
  const user = await requireUser();
  if (deckIds.length === 0) return 0;

  return prisma.card.count({
    where: {
      deckId: { in: deckIds },
      deck: { ownerId: user.id },
      ...(filter === "withImage" ? { imagePath: { not: null } } : {}),
    },
  });
}

/**
 * Réunit dans un paquet les cartes de plusieurs autres, sous forme d'alias.
 *
 * Le cas d'usage : rassembler toutes les figures anatomiques éparpillées dans
 * les paquets d'un cours pour les réviser ensemble, sans les déplacer ni les
 * dupliquer à la main.
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

  // --- Paquet cible ---------------------------------------------------------
  let targetId: string;
  if (input.targetDeckId) {
    const target = await prisma.deck.findFirst({
      where: { id: input.targetDeckId, ownerId: user.id },
      select: { id: true },
    });
    if (!target) return { ok: false, error: "Paquet de destination introuvable." };
    targetId = target.id;
  } else {
    const parsed = deckSchema.safeParse({
      title: input.newDeckTitle ?? "",
      description: "",
      color: "amber",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Titre invalide." };
    }
    const created = await prisma.deck.create({
      data: {
        ownerId: user.id,
        title: parsed.data.title,
        description: "",
        color: parsed.data.color,
        folderId: input.folderId ?? null,
      },
      select: { id: true },
    });
    targetId = created.id;
  }

  // Se reprendre soi-même n'aurait aucun sens et ferait des doublons en boucle.
  const sourceIds = sources.map((d) => d.id).filter((id) => id !== targetId);
  if (sourceIds.length === 0) {
    return { ok: false, error: "Le paquet de destination ne peut pas être sa propre source." };
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
      // Reprendre un alias reviendrait à pointer sur une reprise : on remonte
      // toujours à l'originale, ce qui garde la propagation à un seul niveau.
      aliasOfId: true,
    },
  });
  if (cards.length === 0) return { ok: false, error: "Aucune carte ne correspond." };

  // Ce que le paquet cible contient déjà, par origine : relancer l'opération
  // après avoir ajouté des cartes ne doit pas créer de doublons.
  const existing = await prisma.card.findMany({
    where: { deckId: targetId },
    select: { id: true, aliasOfId: true },
  });
  const already = new Set(existing.map((c) => c.aliasOfId ?? c.id));

  const last = await prisma.card.findFirst({
    where: { deckId: targetId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  let position = (last?.position ?? -1) + 1;

  const toCreate = cards
    .map((card) => ({ card, origin: card.aliasOfId ?? card.id }))
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
        aliasOfId: origin,
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
