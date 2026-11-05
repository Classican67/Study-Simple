import "server-only";

import { prisma } from "@/lib/prisma";
import {
  activiteParJour,
  cleJour,
  decalerJour,
  grilleActivite,
  previsionEcheances,
  series,
  tauxReussite,
  type JourActivite,
} from "@/lib/statistiques";

/** Le fuseau des jours comptés. Une installation personnelle n'en a qu'un. */
const FUSEAU = process.env.APP_TIMEZONE || "Europe/Paris";
/** Vingt-six semaines, plus de quoi remplir la première colonne. */
const JOURS_LUS = 190;
const JOUR_MS = 86_400_000;

/**
 * Les jours d'activité : les réponses, et avant elles les passes de révision.
 *
 * `ReviewAnswer` n'existe que depuis la révision hors ligne. Les passes plus
 * anciennes ne disent que des totaux, mais assez pour ne pas montrer un trou à
 * la place de semaines de travail. Elles ne comptent que les jours sans réponse
 * détaillée : les deux à la fois compteraient double.
 */
async function joursActifs(userId: string, depuis: Date): Promise<Map<string, JourActivite>> {
  const [reponses, passes] = await Promise.all([
    prisma.reviewAnswer.findMany({
      where: { userId, answeredAt: { gte: depuis } },
      select: { answeredAt: true, knew: true },
    }),
    prisma.studySession.findMany({
      where: { userId, startedAt: { gte: depuis } },
      select: { startedAt: true, correctCount: true, missCount: true },
    }),
  ]);
  const jours = activiteParJour(reponses, FUSEAU);
  const details = new Set(jours.keys());
  for (const passe of passes) {
    const jour = cleJour(passe.startedAt, FUSEAU);
    if (details.has(jour)) continue;
    const entree = jours.get(jour) ?? { jour, reponses: 0, reussies: 0 };
    entree.reponses += passe.correctCount + passe.missCount;
    entree.reussies += passe.correctCount;
    if (entree.reponses > 0) jours.set(jour, entree);
  }
  return jours;
}

/** La série en cours — de quoi la montrer sur l'accueil, sans le reste du bilan. */
export async function serieEnCours(userId: string, now = new Date()): Promise<number> {
  const jours = await joursActifs(userId, new Date(now.getTime() - JOURS_LUS * JOUR_MS));
  return series(new Set(jours.keys()), cleJour(now, FUSEAU)).actuelle;
}

export async function bilanDeRevision(userId: string, now = new Date()) {
  const aujourdhui = cleJour(now, FUSEAU);
  const jours = await joursActifs(userId, new Date(now.getTime() - JOURS_LUS * JOUR_MS));
  const { actuelle, meilleure } = series(new Set(jours.keys()), aujourdhui);

  const trenteJours = decalerJour(aujourdhui, -29);
  const recents = [...jours.values()].filter((j) => j.jour >= trenteJours);

  const [totalCartes, etats, echeances, difficiles, paquets, sus] = await Promise.all([
    prisma.card.count({ where: { deck: { ownerId: userId } } }),
    prisma.cardProgress.groupBy({
      by: ["status"],
      where: { userId, card: { deck: { ownerId: userId } } },
      _count: { _all: true },
    }),
    prisma.cardProgress.findMany({
      where: {
        userId,
        dueAt: { lt: new Date(now.getTime() + 15 * JOUR_MS) },
        card: { deck: { ownerId: userId } },
      },
      select: { dueAt: true },
    }),
    prisma.cardProgress.findMany({
      where: { userId, missCount: { gt: 0 }, card: { deck: { ownerId: userId } } },
      orderBy: [{ missCount: "desc" }, { correctCount: "asc" }],
      take: 6,
      select: {
        missCount: true,
        correctCount: true,
        card: { select: { id: true, term: true, deckId: true, deck: { select: { title: true } } } },
      },
    }),
    prisma.deck.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, color: true, _count: { select: { cards: true } } },
    }),
    prisma.cardProgress.findMany({
      where: { userId, status: "known", card: { deck: { ownerId: userId } } },
      select: { card: { select: { deckId: true } } },
    }),
  ]);

  const parEtat = new Map(etats.map((e) => [e.status, e._count._all]));
  const connues = parEtat.get("known") ?? 0;
  const aRevoir = parEtat.get("learning") ?? 0;

  const susParPaquet = new Map<string, number>();
  for (const su of sus) susParPaquet.set(su.card.deckId, (susParPaquet.get(su.card.deckId) ?? 0) + 1);

  return {
    aujourdhui: jours.get(aujourdhui)?.reponses ?? 0,
    serie: actuelle,
    meilleureSerie: meilleure,
    reussite30j: tauxReussite(recents),
    reponses30j: recents.reduce((s, j) => s + j.reponses, 0),
    grille: grilleActivite(jours, aujourdhui),
    prevision: previsionEcheances(
      echeances.flatMap((e) => (e.dueAt ? [e.dueAt] : [])),
      aujourdhui,
      FUSEAU,
    ),
    cartes: {
      total: totalCartes,
      connues,
      aRevoir,
      nouvelles: Math.max(0, totalCartes - connues - aRevoir),
    },
    difficiles: difficiles.map((d) => ({
      id: d.card.id,
      term: d.card.term,
      deckId: d.card.deckId,
      deck: d.card.deck.title,
      rates: d.missCount,
      reussis: d.correctCount,
    })),
    // Les paquets les moins acquis d'abord : c'est là qu'il y a quelque chose à faire.
    paquets: paquets
      .filter((p) => p._count.cards > 0)
      .map((p) => ({
        id: p.id,
        title: p.title,
        color: p.color,
        total: p._count.cards,
        connues: susParPaquet.get(p.id) ?? 0,
      }))
      .sort((a, b) => a.connues / a.total - b.connues / b.total)
      .slice(0, 8),
  };
}

export type Bilan = Awaited<ReturnType<typeof bilanDeRevision>>;
