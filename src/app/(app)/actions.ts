"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { deckSchema } from "@/lib/validation";
import { deleteUnreferencedUploads } from "@/lib/uploads";

export type FormState = { error?: string };

export async function createDeck(
  folderId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = deckSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    color: formData.get("color") ?? "violet",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  // Le paquet naît dans le dossier depuis lequel on a cliqué.
  const deck = await prisma.deck.create({
    data: { ...parsed.data, ownerId: user.id, folderId },
    select: { id: true },
  });

  redirect(`/decks/${deck.id}`);
}

export async function updateDeck(deckId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  const parsed = deckSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    color: formData.get("color") ?? "violet",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  // `updateMany` avec ownerId dans le where : si le paquet n'est pas le sien,
  // zéro ligne touchée plutôt qu'une modification chez quelqu'un d'autre.
  const { count } = await prisma.deck.updateMany({
    where: { id: deckId, ownerId: user.id },
    data: parsed.data,
  });
  if (count === 0) return { error: "Paquet introuvable." };

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/");
  return {};
}

export async function deleteDeck(deckId: string) {
  const user = await requireUser();

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, ownerId: user.id },
    select: { cards: { select: { imagePath: true } } },
  });
  if (!deck) redirect("/");

  // La cascade Prisma nettoie les lignes, pas les fichiers : sans ce ménage,
  // les images resteraient orphelines sur le NAS.
  //
  // On supprime le paquet D'ABORD, puis on n'efface que les fichiers devenus
  // orphelins : une carte reprise dans un autre paquet partage le nom de
  // fichier de son originale. Effacer avant aurait privé l'originale de son
  // image en supprimant le paquet de révision qui la reprend.
  const images = deck.cards.map((c) => c.imagePath);
  await prisma.deck.delete({ where: { id: deckId } });
  await deleteUnreferencedUploads(images);

  revalidatePath("/");
  redirect("/");
}
