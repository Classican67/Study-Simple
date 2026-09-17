import "server-only";

import { prisma } from "@/lib/prisma";
import { nextDueAt } from "@/lib/scheduling";

/**
 * Enregistrer une réponse de révision — une seule fois, à l'heure où elle a
 * été donnée.
 *
 * Trois chemins y mènent : l'action serveur du web, l'API mobile, et la file
 * des réponses données hors ligne. Ils avaient chacun leur copie du calcul ;
 * une réponse rejouée par la file aurait compté double sur l'une et pas sur
 * l'autre. Tout passe donc ici.
 */

export type Reponse = {
  /** Choisi par l'appareil : c'est ce qui rend l'envoi rejouable. */
  id: string;
  cardId: string;
  knew: boolean;
  answeredAt: Date;
};

export type SortReponse =
  /** Appliquée à la progression. */
  | "appliquee"
  /** Déjà reçue : un renvoi après une confirmation perdue. */
  | "deja-recue"
  /** Plus ancienne que la dernière réponse connue : comptée, sans replanifier. */
  | "comptee"
  /** Carte supprimée entre-temps, ou d'un autre compte : rien à faire. */
  | "carte-absente";

/**
 * Tolérance sur l'horloge de l'appareil. Une réponse annoncée dans le futur
 * vient d'un iPad mal réglé : on la ramène à l'heure du serveur plutôt que de
 * planifier une carte depuis demain.
 */
function heureCredible(answeredAt: Date, now: Date): Date {
  return answeredAt.getTime() > now.getTime() ? now : answeredAt;
}

export async function appliquerReponse(
  userId: string,
  reponse: Reponse,
  now: Date = new Date(),
): Promise<SortReponse> {
  const carte = await prisma.card.findFirst({
    where: { id: reponse.cardId, deck: { ownerId: userId } },
    select: { id: true },
  });
  if (!carte) return "carte-absente";

  const at = heureCredible(reponse.answeredAt, now);

  try {
    return await appliquerDansUneTransaction(userId, reponse, at);
  } catch (error) {
    // Deux renvois simultanés du même envoi : le second bute sur la clé
    // primaire. C'est exactement le cas « déjà reçue ».
    if ((error as { code?: string }).code === "P2002") return "deja-recue";
    throw error;
  }
}

function appliquerDansUneTransaction(userId: string, reponse: Reponse, at: Date) {
  return prisma.$transaction(async (tx): Promise<SortReponse> => {
    if (await tx.reviewAnswer.findUnique({ where: { id: reponse.id }, select: { id: true } })) {
      return "deja-recue";
    }

    await tx.reviewAnswer.create({
      data: { id: reponse.id, userId, cardId: reponse.cardId, knew: reponse.knew, answeredAt: at },
    });

    const existant = await tx.cardProgress.findUnique({
      where: { userId_cardId: { userId, cardId: reponse.cardId } },
      select: { streak: true, lastSeenAt: true },
    });

    const compteurs = {
      correctCount: { increment: reponse.knew ? 1 : 0 },
      missCount: { increment: reponse.knew ? 0 : 1 },
    };

    /*
     * Une réponse plus ancienne que la dernière connue arrive d'un appareil
     * resté hors ligne, alors qu'on a révisé ailleurs depuis. Elle compte dans
     * les statistiques, mais c'est la plus récente qui décide de la date de
     * retour : sinon l'iPad qui retrouve le réseau jeudi réécrirait la
     * planification de mercredi avec celle de mardi.
     */
    if (existant?.lastSeenAt && at.getTime() < existant.lastSeenAt.getTime()) {
      await tx.cardProgress.update({
        where: { userId_cardId: { userId, cardId: reponse.cardId } },
        data: compteurs,
      });
      return "comptee";
    }

    // Une bonne réponse fait passer « su » ; une mauvaise remet la carte en
    // apprentissage et casse la série, quelle que soit la progression acquise.
    const streak = reponse.knew ? (existant?.streak ?? 0) + 1 : 0;
    const status = reponse.knew ? "known" : "learning";
    const dueAt = nextDueAt(streak, at);

    await tx.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId: reponse.cardId } },
      create: {
        userId,
        cardId: reponse.cardId,
        status,
        streak,
        correctCount: reponse.knew ? 1 : 0,
        missCount: reponse.knew ? 0 : 1,
        lastSeenAt: at,
        dueAt,
      },
      update: { ...compteurs, status, streak, lastSeenAt: at, dueAt },
    });
    return "appliquee";
  });
}

export type SessionTerminee = {
  id: string;
  deckId: string;
  correctCount: number;
  missCount: number;
  finishedAt: Date;
};

/** Même principe : l'identifiant vient de l'appareil, un renvoi ne crée rien. */
export async function enregistrerSession(
  userId: string,
  session: SessionTerminee,
  now: Date = new Date(),
): Promise<boolean> {
  const paquet = await prisma.deck.findFirst({
    where: { id: session.deckId, ownerId: userId },
    select: { id: true },
  });
  if (!paquet) return false;

  const fin = heureCredible(session.finishedAt, now);
  await prisma.studySession.upsert({
    where: { id: session.id },
    create: {
      id: session.id,
      userId,
      deckId: session.deckId,
      startedAt: fin,
      finishedAt: fin,
      correctCount: session.correctCount,
      missCount: session.missCount,
    },
    update: {},
  });
  return true;
}
