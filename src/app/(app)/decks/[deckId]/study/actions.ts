"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Les réponses et la fin de session ne passent plus par ici : elles sont
// d'abord posées sur l'appareil, puis envoyées par la file de révision
// (`POST /api/revision`), ce qui leur permet de survivre à une coupure.

// Remet tout le paquet à zéro pour cet utilisateur seulement : les autres
// comptes gardent leur progression sur les mêmes cartes.
export async function resetDeckProgress(deckId: string) {
  const user = await requireUser();

  await prisma.cardProgress.deleteMany({
    where: { userId: user.id, card: { deckId, deck: { ownerId: user.id } } },
  });

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/");
}
