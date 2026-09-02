import type { PrismaClient } from "@prisma/client";

import { buildSearchText } from "@/lib/search";

/**
 * Reconstruction de l'index de recherche.
 *
 * `searchText` est une donnée dérivée : le terme et la définition, normalisés.
 * Elle peut diverger de deux façons — une carte créée avant l'arrivée de la
 * colonne, ou une carte indexée par une version antérieure des règles de
 * normalisation (l'ajout de NFKD, par exemple, change la forme repliée des
 * ligatures). Ne remplir que les cases vides ne rattrape que le premier cas.
 *
 * On relit donc toutes les cartes et on ne réécrit que celles dont le texte
 * calculé diffère de celui stocké. Sur une base à jour, aucune écriture : c'est
 * ce qui permet de lancer l'opération à chaque démarrage du serveur, et donc de
 * ne jamais dépendre d'un script exécuté à la main.
 *
 * Volontairement sans `server-only` : le script en ligne de commande l'importe
 * hors du contexte Next.
 */

// Par paquets : une base de plusieurs milliers de cartes ne doit pas être
// chargée d'un bloc en mémoire.
const BATCH = 500;

export type ReindexReport = { seen: number; fixed: number };

export async function reindexCards(
  prisma: PrismaClient,
  onProgress?: (report: ReindexReport) => void,
): Promise<ReindexReport> {
  let cursor: string | undefined;
  let seen = 0;
  let fixed = 0;

  for (;;) {
    // Pagination par curseur plutôt que par `skip` : une réécriture ne déplace
    // pas la ligne, la progression reste donc exacte.
    const cards = await prisma.card.findMany({
      select: { id: true, term: true, definition: true, searchText: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (cards.length === 0) break;

    const stale = cards
      .map((card) => ({ id: card.id, searchText: buildSearchText(card.term, card.definition) }))
      .filter((row, index) => row.searchText !== cards[index].searchText);

    if (stale.length > 0) {
      await prisma.$transaction(
        stale.map((row) =>
          prisma.card.update({ where: { id: row.id }, data: { searchText: row.searchText } }),
        ),
      );
    }

    seen += cards.length;
    fixed += stale.length;
    cursor = cards[cards.length - 1].id;
    onProgress?.({ seen, fixed });
  }

  return { seen, fixed };
}
