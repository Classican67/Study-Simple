"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { cardSchema } from "@/lib/validation";
import { MAX_IMPORT_CARDS, parseImport, type ImportOptions } from "@/lib/import";
import { deleteUpload, saveUpload, UploadError } from "@/lib/uploads";

export type CardFormState = { error?: string; ok?: boolean };

// Vérifie que le paquet appartient bien à l'utilisateur connecté.
// Toute écriture sur une carte passe par là avant de toucher la base.
async function assertOwnsDeck(deckId: string, userId: string) {
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, ownerId: userId },
    select: { id: true },
  });
  return Boolean(deck);
}

// L'image arrive dans le même envoi que le texte : le formulaire est en
// multipart, et le fichier n'est écrit sur disque qu'une fois le texte validé.
async function readImage(formData: FormData): Promise<string | null | undefined> {
  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    return saveUpload(file);
  }
  // `remove-image` distingue « on ne touche pas à l'image » de « on la retire ».
  if (formData.get("remove-image") === "1") return null;
  return undefined;
}

export async function createCard(
  deckId: string,
  _prev: CardFormState,
  formData: FormData,
): Promise<CardFormState> {
  const user = await requireUser();
  if (!(await assertOwnsDeck(deckId, user.id))) return { error: "Paquet introuvable." };

  const parsed = cardSchema.safeParse({
    term: formData.get("term"),
    definition: formData.get("definition"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  let imagePath: string | null = null;
  try {
    imagePath = (await readImage(formData)) ?? null;
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }

  // Nouvelle carte en fin de liste : on prend la position max existante + 1.
  const last = await prisma.card.findFirst({
    where: { deckId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.card.create({
    data: {
      deckId,
      term: parsed.data.term,
      definition: parsed.data.definition,
      imagePath,
      position: (last?.position ?? -1) + 1,
    },
  });
  await prisma.deck.update({ where: { id: deckId }, data: { updatedAt: new Date() } });

  revalidatePath(`/decks/${deckId}`);
  return { ok: true };
}

export async function updateCard(
  cardId: string,
  _prev: CardFormState,
  formData: FormData,
): Promise<CardFormState> {
  const user = await requireUser();

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { ownerId: user.id } },
    select: { id: true, deckId: true, imagePath: true },
  });
  if (!card) return { error: "Carte introuvable." };

  const parsed = cardSchema.safeParse({
    term: formData.get("term"),
    definition: formData.get("definition"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  let nextImage: string | null | undefined;
  try {
    nextImage = await readImage(formData);
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }

  await prisma.card.update({
    where: { id: cardId },
    data: {
      term: parsed.data.term,
      definition: parsed.data.definition,
      // `undefined` laisse Prisma ignorer le champ : l'image reste en place.
      ...(nextImage === undefined ? {} : { imagePath: nextImage }),
    },
  });

  // L'ancien fichier n'est supprimé qu'après la mise à jour réussie, pour ne
  // pas perdre l'image si l'écriture en base échoue.
  if (nextImage !== undefined && card.imagePath && card.imagePath !== nextImage) {
    await deleteUpload(card.imagePath);
  }

  revalidatePath(`/decks/${card.deckId}`);
  return { ok: true };
}

export async function deleteCard(cardId: string) {
  const user = await requireUser();

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { ownerId: user.id } },
    select: { id: true, deckId: true, imagePath: true },
  });
  if (!card) return;

  await prisma.card.delete({ where: { id: cardId } });
  if (card.imagePath) await deleteUpload(card.imagePath);

  revalidatePath(`/decks/${card.deckId}`);
}

export type ImportState = {
  error?: string;
  created?: number;
  duplicates?: number;
  skipped?: number;
};

export async function importCards(
  deckId: string,
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await requireUser();
  if (!(await assertOwnsDeck(deckId, user.id))) return { error: "Paquet introuvable." };

  const raw = formData.get("text");
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "Colle d'abord tes cartes dans le champ." };
  }

  // Le texte brut est réanalysé ici avec les mêmes règles que l'aperçu :
  // on ne fait pas confiance au découpage fait dans le navigateur, qui peut
  // être modifié avant l'envoi.
  const options: ImportOptions = {
    termSeparator: (formData.get("termSeparator") as ImportOptions["termSeparator"]) ?? "tab",
    cardSeparator: (formData.get("cardSeparator") as ImportOptions["cardSeparator"]) ?? "newline",
    customTerm: (formData.get("customTerm") as string) || undefined,
    customCard: (formData.get("customCard") as string) || undefined,
  };

  const { cards, skipped } = parseImport(raw, options);
  if (cards.length === 0) {
    return { error: "Aucune carte reconnue. Vérifie les séparateurs." };
  }
  if (cards.length > MAX_IMPORT_CARDS) {
    return { error: `Import limité à ${MAX_IMPORT_CARDS} cartes à la fois (${cards.length} trouvées).` };
  }

  const parsed = z.array(cardSchema.pick({ term: true, definition: true })).safeParse(cards);
  if (!parsed.success) {
    return { error: "Certaines cartes dépassent la longueur autorisée." };
  }

  const skipDuplicates = formData.get("skipDuplicates") === "on";

  // Comparaison insensible à la casse et aux espaces de bord : un même terme
  // recollé depuis Quizlet ne doit pas créer un doublon pour une majuscule.
  const existing = new Set(
    (await prisma.card.findMany({ where: { deckId }, select: { term: true } })).map((c) =>
      c.term.trim().toLowerCase(),
    ),
  );

  const seenInBatch = new Set<string>();
  const toCreate: { term: string; definition: string }[] = [];
  let duplicates = 0;

  for (const card of parsed.data) {
    const key = card.term.trim().toLowerCase();
    // Le collage lui-même peut contenir deux fois le même terme.
    if (skipDuplicates && (existing.has(key) || seenInBatch.has(key))) {
      duplicates++;
      continue;
    }
    seenInBatch.add(key);
    toCreate.push(card);
  }

  if (toCreate.length === 0) {
    return { error: "Toutes les cartes existent déjà dans ce paquet.", duplicates };
  }

  const last = await prisma.card.findFirst({
    where: { deckId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  let position = (last?.position ?? -1) + 1;

  await prisma.card.createMany({
    data: toCreate.map((card) => ({ ...card, deckId, position: position++ })),
  });
  await prisma.deck.update({ where: { id: deckId }, data: { updatedAt: new Date() } });

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/");

  return { created: toCreate.length, duplicates, skipped: skipped.length };
}

// --- Édition en ligne -------------------------------------------------------
// Ces actions servent l'éditeur façon Quizlet : elles sont appelées au fil de
// la saisie, donc volontairement légères et SANS revalidatePath — rafraîchir
// la page à chaque sortie de champ ferait sauter le curseur de l'utilisateur.

export type SaveResult = { ok: boolean; error?: string };

export async function saveCardText(
  cardId: string,
  term: string,
  definition: string,
): Promise<SaveResult> {
  const user = await requireUser();

  const parsed = cardSchema.pick({ term: true, definition: true }).safeParse({ term, definition });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Contenu invalide." };
  }

  const { count } = await prisma.card.updateMany({
    where: { id: cardId, deck: { ownerId: user.id } },
    data: parsed.data,
  });
  return count === 1 ? { ok: true } : { ok: false, error: "Carte introuvable." };
}

// Crée une carte vide en fin de liste et la renvoie, pour que l'éditeur
// l'ajoute à sa liste sans recharger la page.
export async function addEmptyCard(deckId: string) {
  const user = await requireUser();
  if (!(await assertOwnsDeck(deckId, user.id))) return null;

  const last = await prisma.card.findFirst({
    where: { deckId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  // Les champs sont requis en base : on part d'un espace, remplacé dès la
  // première saisie. Une chaîne vide ferait échouer la validation au premier
  // enregistrement automatique.
  return prisma.card.create({
    data: { deckId, term: " ", definition: " ", position: (last?.position ?? -1) + 1 },
    select: { id: true, term: true, definition: true, imagePath: true },
  });
}

export async function reorderCards(deckId: string, orderedIds: string[]): Promise<SaveResult> {
  const user = await requireUser();
  if (!(await assertOwnsDeck(deckId, user.id))) return { ok: false, error: "Paquet introuvable." };

  const existing = await prisma.card.findMany({ where: { deckId }, select: { id: true } });
  const known = new Set(existing.map((c) => c.id));

  // L'ordre reçu doit décrire exactement les cartes du paquet : ni un id
  // étranger, ni un oubli qui laisserait des positions en double.
  if (orderedIds.length !== existing.length || !orderedIds.every((id) => known.has(id))) {
    return { ok: false, error: "Ordre invalide." };
  }

  // Une transaction : un ordre à moitié écrit vaudrait moins que l'ancien.
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.card.update({ where: { id }, data: { position: index } }),
    ),
  );

  revalidatePath(`/decks/${deckId}`);
  return { ok: true };
}

export async function setCardImage(cardId: string, formData: FormData): Promise<
  SaveResult & { imagePath?: string | null }
> {
  const user = await requireUser();

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { ownerId: user.id } },
    select: { id: true, imagePath: true },
  });
  if (!card) return { ok: false, error: "Carte introuvable." };

  const file = formData.get("image");
  const remove = formData.get("remove") === "1";

  let next: string | null;
  if (remove) {
    next = null;
  } else if (file instanceof File && file.size > 0) {
    try {
      next = await saveUpload(file);
    } catch (error) {
      if (error instanceof UploadError) return { ok: false, error: error.message };
      throw error;
    }
  } else {
    return { ok: false, error: "Aucun fichier reçu." };
  }

  await prisma.card.update({ where: { id: cardId }, data: { imagePath: next } });
  // L'ancien fichier ne part qu'après l'écriture réussie en base.
  if (card.imagePath && card.imagePath !== next) await deleteUpload(card.imagePath);

  return { ok: true, imagePath: next };
}
