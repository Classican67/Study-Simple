/**
 * Reconstruit l'index de recherche des cartes.
 *
 *   npm run db:backfill-search
 *
 * Le serveur fait la même chose à chaque démarrage (voir src/instrumentation.ts) ;
 * ce script sert à la forcer sans redémarrer, ou à la lancer depuis un conteneur.
 * La logique et son explication sont dans src/lib/search-index.ts.
 */
import { PrismaClient } from "@prisma/client";

import { reindexCards } from "../src/lib/search-index";

const prisma = new PrismaClient();

reindexCards(prisma, ({ seen, fixed }) =>
  process.stdout.write(`\r  ${seen} carte(s) relue(s), ${fixed} réindexée(s)…`),
)
  .then(({ seen, fixed }) => {
    console.log(
      fixed === 0
        ? `\rIndex à jour : ${seen} carte(s) vérifiée(s).            `
        : `\n✅ ${fixed} carte(s) réindexée(s) sur ${seen}.`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
