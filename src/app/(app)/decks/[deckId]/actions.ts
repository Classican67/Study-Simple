"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { cardSchema } from "@/lib/validation";
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
