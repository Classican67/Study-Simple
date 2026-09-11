<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fiches — exigences d'interface

L'interface n'est pas considérée comme faite tant qu'elle n'a pas été **regardée
et mesurée**. Une classe présente dans le code ne prouve rien : elle peut être
écrasée, non générée, ou s'appliquer à un conteneur qui n'a pas la taille
attendue. Trois défauts livrés l'ont été parce que le code se lisait bien.

## Vérifier, pas relire

Après toute modification visuelle, depuis `verify/` (serveur sur le port 3100) :

- `./bootstrap.sh` — installe Playwright si besoin, régénère le jeton de session
- `node shoot.mjs` — captures, débordements horizontaux, erreurs console
- `node audit.mjs` — contraste WCAG (4.5:1), cibles tactiles (44 px), et
  cohérence des positions : chaque classe `absolute` / `fixed` / `sticky` est
  comparée au `position` réellement calculé
- `node hauteur.mjs` — la révision doit tenir dans l'écran, sur iPhone, iPad
  portrait et paysage, iPad mini et portable. `shoot.mjs` ne mesure que le
  débordement **horizontal** : c'est ce qui a laissé passer 70 à 227 px de
  dépassement vertical selon l'appareil
- `node notes-e2e.mjs` — notes : texte, tableau calculé, croquis au stylet,
  et persistance de tout cela
- `node notes-avancees-e2e.mjs` — notes : dossiers et fil d'Ariane, recherche
  par mots-clés et filtres de contenu, page manuscrite en plein écran
- `node export-pdf-e2e.mjs` — export d'une note annotée : forme aplatie et
  forme à annotations `/Ink` conformes à ISO 32000 (avec leur flux d'apparence),
  document d'origine inchangé, et le PDF produit se réimporte dans l'app
- `node document-e2e.mjs` — import d'un document à annoter : le PDF devient
  une page manuscrite par page, l'annotation ne l'efface pas, et un format
  inconnu est refusé proprement
- `node glisser-e2e.mjs` — glisser une note ou un paquet dans un dossier, en
  **Pointer Events tactiles** : le glisser-déposer natif du navigateur ne
  fonctionne pas au toucher, c'est une limite de l'API et non un oubli
- `node copies-e2e.mjs` — regroupement de cartes : la copie et l'originale
  restent indépendantes dans les deux sens, et supprimer l'une ne prive jamais
  l'autre de son image
- `node selection-e2e.mjs` — choix des paquets à regrouper : rien de coché
  d'avance, compte par paquet, total qui suit la sélection

Puis **ouvrir les captures**. Une mesure qui passe ne dit pas que c'est joli.

Ces scripts vivaient dans le dossier temporaire de session ; le système l'efface
sans prévenir, et l'outillage disparaissait en pleine tâche. Ils sont donc dans
le dépôt. Playwright reste installé dans `verify/` seul : l'application n'a pas
à le porter dans ses dépendances.

L'audit ne voit que les états qu'il visite. Un élément qui n'apparaît que sous
condition — une croix d'effacement présente seulement si le champ contient du
texte, une barre de mise en forme masquée hors focus — doit recevoir son propre
scénario, sinon il n'est jamais examiné. Deux défauts y sont restés cachés
exactement pour cette raison.

## Prouver le garde-fou

Un test de régression qui n'a jamais échoué ne garantit rien. Réintroduire le
défaut, constater que le test le signale, puis restaurer. Une sonde ajoutée à
`audit.mjs` a été validée ainsi : au premier essai elle ne voyait rien.

Les vérifications qui tiennent sans navigateur vont dans `tests/` — ordre des
couches CSS, en-têtes HTTP, ordre des instructions du `Dockerfile`.

## Pièges rencontrés

- **Couches CSS.** Une règle maison dans `@layer utilities` passe *après* celles
  de Tailwind et gagne à spécificité égale. Tout ce qu'un utilitaire doit
  pouvoir écraser (`position`, ombres, typographie) appartient à
  `@layer components`. Voir `tests/styles.test.ts`.
- **Contrôles natifs.** `input[type="search"]` fait dessiner au navigateur sa
  propre croix, à côté de la nôtre. Neutraliser ce que l'on remplace.
- **Playwright.** La taille d'écran se passe en `viewport: { width, height }` ;
  des clés à plat sont ignorées sans erreur et tout est mesuré en 1280×720.
- **Couleurs.** Chromium renvoie les couleurs calculées en `oklch()`. Les lire
  comme du RGB donne des rapports de contraste absurdes ; passer par un canvas.
- **Material 3.** Cible tactile de 48 dp, `state-layer` sur tout ce qui se
  touche, jamais de teinte codée en dur à la place d'un rôle de couleur.
- **Hauteur en flexbox.** Un enfant de colonne flexible refuse de descendre
  sous la hauteur de son contenu tant qu'il n'a pas `min-h-0` : sans lui,
  `flex-1` ne borne rien et le débordement revient. Et une hauteur fixe en
  `clamp()` ignore par construction ce qui l'entoure — c'est au conteneur
  d'être borné et à l'élément d'absorber la place restante.
- **Navigateur de vérification trop ancien.** `verify/` installe Playwright en
  version **courante**, pas figée : pdf.js s'appuie sur des fonctions arrivées
  dans Chrome 140, et un Chromium plus ancien échoue sur « toHex is not a
  function ». L'erreur accuse l'application alors qu'elle vient de l'outil.
- **Isolation des essais.** La base de vérification accumule ce que les essais
  précédents y ont laissé. Un test qui rouvre « la première note » ou cherche
  un texte fixe finit par viser au hasard et accuser l'application à tort.
  Repartir de `cp data/dev.db verify/verif.db`, créer ses propres données avec
  un nom horodaté, et comparer un avant/après plutôt qu'un texte attendu.
- **Client Prisma périmé.** Modifier `schema.prisma` ne suffit pas : le client
  généré vit dans `node_modules/.prisma/client`, et un serveur déjà lancé garde
  l'ancien en mémoire. L'échec arrive à l'exécution, avec un message obscur
  (« Unknown field … for select statement »), sans que la compilation ni les
  tests n'aient rien vu. **Après toute migration, redémarrer le serveur.**
  `npm run dev` et `npm run build` régénèrent désormais le client avant de
  démarrer, et `tests/prisma-client.test.ts` compare le schéma au client.
- **Fichiers partagés.** Le regroupement copie les cartes, et la copie reprend
  le **nom de fichier** de l'image de l'originale. Effacer ce fichier en
  supprimant l'une priverait l'autre de son image. Toute suppression d'image
  passe donc par `deleteUnreferencedUploads`, **après** l'écriture en base :
  c'est l'état final qui dit si un fichier est devenu orphelin.
- **Jeton de session périmé.** Les scripts de `scratchpad/` s'authentifient par
  un cookie stocké dans `ctx.json`. Expiré, il fait rediriger vers `/login` : le
  script mesure alors l'écran de connexion et annonce que tout va bien. Devant
  un résultat étonnamment propre, vérifier d'abord que la page auditée est la
  bonne (`curl -sI -H "Cookie: fiches_session=…" …` doit répondre 200, pas 307).

## Portée

Ce qui touche à l'écran se vérifie en clair **et** en sombre, sur téléphone
**et** en desktop — la navigation du bandeau est restée sous la cible tactile
jusqu'à ce qu'un scénario desktop soit ajouté.

Ne jamais laisser de carte ou de paquet d'essai dans la base : travailler sur
une copie (`cp data/dev.db …`), et vérifier les comptes après coup.

La copie de base **ne suffit pas** : `UPLOAD_DIR` vaut `data/uploads` par
défaut, quelle que soit la base. Un essai qui téléverse une image écrit donc
dans les fichiers réels. Lancer le serveur de vérification avec les deux :

```bash
DATABASE_URL="file:$PWD/verify/verif.db" UPLOAD_DIR="$PWD/verify/uploads" \
  npx next start -p 3100
```

Cinq images d'essai se sont retrouvées dans `data/uploads` avant que ce soit
noté ici.
