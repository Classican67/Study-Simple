/**
 * Code exécuté une fois au démarrage du serveur.
 *
 * Sert à remettre l'index de recherche d'aplomb sans intervention : jusqu'ici,
 * il n'était rempli que par l'entrypoint Docker, donc une installation lancée
 * autrement — `next dev`, `next start`, un conteneur déjà démarré au moment de
 * la mise à jour — gardait des cartes introuvables, sans rien signaler.
 */
export async function register() {
  // `register` est aussi appelé pour le runtime Edge, qui n'a ni Prisma ni
  // accès à la base.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ prisma }, { reindexCards }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/search-index"),
  ]);

  /*
   * Le journal à écriture anticipée : les lectures n'attendent plus les écritures,
   * et une écriture ne recopie plus la page dans un journal puis la réécrit. Pour
   * une app qui enregistre chaque seconde pendant qu'on écrit, c'est ce qui compte.
   * Le réglage vit dans le fichier : il suffit de le poser une fois. La base est
   * sur un disque local (cf. README) et `restore.sh` retire déjà les journaux.
   */
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL").catch((error) => {
    console.error("[base] journal WAL impossible :", error);
  });

  /*
   * Sans `await` : Next attend la fin de `register` avant d'accepter la
   * moindre requête, et une base fournie mettrait le démarrage à l'arrêt. La
   * recherche reste juste pendant ce temps — elle lit aussi les cartes non
   * encore indexées.
   */
  void reindexCards(prisma)
    .then(({ seen, fixed }) => {
      if (fixed > 0) console.log(`[recherche] ${fixed} carte(s) réindexée(s) sur ${seen}.`);
    })
    .catch((error) => {
      // Une base absente au démarrage ne doit pas empêcher le serveur de
      // servir : la recherche se rabat sur la lecture directe des cartes.
      console.error("[recherche] réindexation impossible :", error);
    });

  // La lecture des documents reprend où elle en était, et rattrape ceux d'avant.
  const { reprendreIndexation } = await import("@/lib/documents-index");
  void reprendreIndexation().catch((error) => {
    console.error("[documents] reprise impossible :", error);
  });

  // La sauvegarde Google Drive : rien ne démarre si elle n'est pas configurée.
  const { demarrerPlanificateur } = await import("@/lib/google-drive/planificateur");
  demarrerPlanificateur();
}
