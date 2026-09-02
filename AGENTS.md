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

Après toute modification visuelle, depuis `scratchpad/` :

- `node shoot.mjs` — captures, débordements horizontaux, erreurs console
- `node audit.mjs` — contraste WCAG (4.5:1), cibles tactiles (44 px), et
  cohérence des positions : chaque classe `absolute` / `fixed` / `sticky` est
  comparée au `position` réellement calculé
- `node hauteur.mjs` — la révision doit tenir dans l'écran, sur iPhone, iPad
  portrait et paysage, iPad mini et portable. `shoot.mjs` ne mesure que le
  débordement **horizontal** : c'est ce qui a laissé passer 70 à 227 px de
  dépassement vertical selon l'appareil, et obligé à faire défiler la page
  pour atteindre les réglages

Puis **ouvrir les captures**. Une mesure qui passe ne dit pas que c'est joli.

L'audit ne voit que les états qu'il visite. Un élément qui n'apparaît que sous
condition — une croix d'effacement présente seulement si le champ contient du
texte — doit recevoir son propre scénario, sinon il n'est jamais examiné. Un
défaut y est resté caché exactement pour cette raison.

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
