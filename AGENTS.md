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
- `node orientation-e2e.mjs` — **une page manuscrite remplit l'écran dans les
  deux orientations** : en ligne sur iPad, iPad mini et iPhone, portrait puis
  paysage sans recharger, et le plein écran ouvert dans une orientation puis
  tourné
- `node menus-e2e.mjs` — **navigation et menus des notes** : revenir d'une note
  ramène à son dossier, clic droit, appui long au doigt, bouton ⋮ et clavier
  ouvrent le même menu, chaque option (créer, renommer, dupliquer, ranger,
  déplacer, supprimer) fait ce qu'elle annonce, et la pastille « maîtrisée »
  s'allume et s'éteint sans toucher au tri
- `node sauvegarde-e2e.mjs` — **ce qui est écrit ne se perd pas** : on coupe
  l'enregistrement pour de vrai, on écrit, **on recharge en pleine panne** et
  l'encre doit être là ; la file repart seule au retour du réseau ; un 401 et
  une redirection vers `/login` se disent au lieu de passer pour un succès ; et
  la sauvegarde de secours se télécharge
- `node regard-sauvegarde.mjs` — la pastille d'enregistrement dans ses cinq
  états, mesurée et photographiée en clair et en sombre, sur téléphone et en
  desktop. `audit.mjs` ne la voit pas : il saute les éléments qui ont des
  enfants et ceux dont l'opacité est nulle
- `node hors-ligne-e2e.mjs` — **réviser sans le serveur** : épingler un
  paquet ou un dossier (et l'héritage qui en découle), révision servie par la
  page hors ligne, rechargement en pleine panne, réponses qui partent seules au
  retour du réseau, **une fois**, datées de l'heure où elles ont été données ;
  retrait qui libère la place sans réseau, déconnexion qui vide l'appareil
- `node hors-ligne-notes-e2e.mjs` — **consulter et annoter une note sans le
  serveur** : copie gardée qui suit ce que le serveur confirme, option du menu
  d'un dossier de notes, fichiers tous en cache avant que la pastille ne
  paraisse (réseau ralenti exprès), polycopié dont on lit les pixels hors
  ligne, trait écrit hors ligne qui arrive au retour du réseau
- `node regard-hors-ligne.mjs` — la puce « Garder hors ligne » dans ses états,
  les pastilles, le menu et la page hors ligne, en clair et en sombre, sur
  téléphone et en desktop. `audit.mjs` ne voit rien de tout cela : il faut
  d'abord garder quelque chose, puis couper le réseau
- `node notes-e2e.mjs` — notes : texte, tableau calculé, croquis au stylet,
  et persistance de tout cela
- `node notes-avancees-e2e.mjs` — notes : dossiers et fil d'Ariane, recherche
  par mots-clés et filtres de contenu, page manuscrite en plein écran
- `node ajout-page-e2e.mjs` — **« Ajouter une page » depuis une surface qui
  n'est pas encore une pile** : la page d'une note neuve et un croquis simple
  peuvent grandir, le trait déjà posé ne bouge pas, et la feuille ajoutée après
  une photo a la forme d'une feuille, pas celle du cliché
- `node pages-e2e.mjs` — pages d'une note : la gomme précise coupe le trait au
  lieu de l'effacer, la duplication rend une copie indépendante, et le volet
  montre les pages en vignettes
- `node dossiers-e2e.mjs` — les dossiers des paquets et ceux des notes ne se
  mélangent pas, et la recherche sait dans lesquels chercher
- `node vignettes-e2e.mjs` — liste des notes : la vignette montre la première
  page, les tailles d'affichage et le tri vivent dans l'adresse, et la liste
  reste légère malgré les aperçus
- `node ecriture-e2e.mjs` — **fluidité, netteté et sensation du manuscrit** :
  épaisseur réellement obtenue contre épaisseur demandée, égalité entre ce qu'on
  voit en écrivant et ce qui reste une fois la pointe levée, résolution de
  l'encre au zoom, coût d'un trait sur page vide *puis* sur page dense, main
  posée sur la barre d'outils, appui maintenu qui ne sélectionne rien, et encre
  qui ne se redessine pas quand on défile. Les mesures passent par un espion
  posé sur `CanvasRenderingContext2D` et par la lecture des pixels des couches :
  rien n'est ajouté à l'app pour se laisser observer
- `node regard-ecriture.mjs` — captures de l'écriture à 1× et agrandie, en
  clair et en sombre. À **ouvrir** : la mesure dit que le trait fait la bonne
  épaisseur, pas qu'il a l'air d'une encre
- `node fonds-e2e.mjs` — **pages ajoutées et fonds de page** : glisser une
  feuille dans un document importé sans décaler les annotations, les quatre
  fonds sur la bonne page, l'interligne qui suit le zoom, et le réglage
  réellement présent dans le PDF exporté
- `node regard-fonds.mjs` — captures des quatre fonds, en clair et en sombre
- `node regard-export.mjs` — le PDF exporté, relu par l'application et
  photographié page par page
- `node photo-e2e.mjs` — **photographier une page pour l'annoter** : la photo
  devient une page au format de l'image, on écrit dessus, tout survit au
  rechargement, la vignette la montre, le PDF l'embarque, et l'encre reste
  lisible dessus en thème sombre
- `node regard-photo.mjs` — captures d'une photo annotée, en clair et en sombre
- `node historique-e2e.mjs` — **Annuler rend ce que la dernière action a
  changé** : un coup de gomme, la page effacée, un trait ; Annuler et Rétablir
  grisés quand il n'y a rien à faire ; deux doigts tapés annulent, trois
  rétablissent, deux doigts qui glissent n'annulent rien ; l'anneau de la gomme
  se montre sous la pointe et disparaît quand elle part
- `node page-photo-e2e.mjs` — **une photo ajoutée depuis la barre d'outils
  devient une page** : sur une page simple (qui devient une pile), au milieu
  d'une pile, sur un document importé ; annotations qui descendent avec leur
  page, pas de fond de cahier proposé sur une photo, Annuler qui retire la page
  **et son fichier**, plein écran et téléphone. Et une note neuve s'ouvre sur
  une page manuscrite vierge
- `node page-document-e2e.mjs` — **un PDF ou un document Word ajouté depuis la
  barre d'outils** : il devient ses pages après la page courante, sans créer de
  bloc, en ligne comme en plein écran ; Annuler retire tout le document **et son
  fichier** ; un faux PDF est refusé sans rien laisser sur le disque
- `node couleur-e2e.mjs` — **roue chromatique** : réglage au clavier et au
  geste, code tapé pris tel quel, couleur **réellement peinte** sur les tuiles,
  après rechargement, dans le PDF exporté et en thème sombre, couleurs récentes,
  et barre qui ne déborde pas sur téléphone
- `node regard-palette.mjs` — captures de la barre d'outils, sur téléphone et en
  desktop, en clair et en sombre, avec le stylo, le surligneur et la gomme
- `node telephone-e2e.mjs` — **documents et photos sur téléphone** (393 px, trois
  pixels par point) : le PDF rendu à la densité de l'écran, une surface pas plus
  haute que ses pages, et en plein écran aucun bouton de la palette recouvert —
  ni par la barre de navigation, ni par le repère de page
- `node import-e2e.mjs` — **importer un document depuis le système** : dépôt
  d'un fichier sur la liste des notes, rangement dans le dossier ouvert, titre
  repris du nom de fichier, refus d'un autre format, et la réponse attendue par
  la feuille de partage — une redirection, pas du JSON
- `node regard-depot.mjs` — capture du voile de dépôt, en clair et en sombre
- `node palette-e2e.mjs` — barre d'outils de la page manuscrite : les réglages
  suivent l'outil courant, chaque outil retient les siens, le verrou du stylet
  et la gomme sélective font ce qu'ils annoncent
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

Docker n'est pas installé sur la machine de développement. Les trois derniers
échecs de déploiement ne se voyaient qu'au build de l'image ; on les reproduit
maintenant **sans Docker**, en rejouant les étapes du `Dockerfile` dans un
dossier temporaire — copier ce qu'il copie, `npm ci`, `npm run build`,
`npm ci --omit=dev` — puis en démarrant le serveur ainsi obtenu. Trois minutes,
et cela dit ce qu'un test ne dira jamais.

Les vérifications qui tiennent sans navigateur vont dans `tests/` — ordre des
couches CSS, en-têtes HTTP, ordre des instructions du `Dockerfile`, cohérence
du verrou npm.

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
- **Constante exportée d'un module client.** Une valeur exportée depuis un
  fichier `"use client"` n'arrive pas comme une vraie valeur dans un composant
  serveur : on n'y reçoit qu'une référence, et l'appeler échoue à l'exécution
  sur un « includes is not a function » peu parlant. Les tableaux et listes
  partagés vont dans un module neutre de `src/lib/`.
- **Un réglage doit tomber *sur* un pixel de l'écran.** Sept millimètres d'une
  page A4 valent 25,4291 px pour une page de mille soixante-huit : le navigateur
  étale alors chaque trait sur deux rangées, et il ne l'étale pas de la même
  façon selon l'orientation. Les verticales d'un quadrillage sortaient plus
  épaisses et plus sombres que les horizontales, et les carreaux n'étaient pas
  carrés — un désordre qui se voit tout de suite et qu'aucune mesure de
  proportion ne révèle. Le pas est donc arrondi (`paperStepPx`) à la densité de
  **l'écran**, qu'il ne faut pas confondre avec celle du **dessin** : cette
  dernière est plafonnée à deux pour la mémoire vidéo, et arrondir dessus
  laissait un pas de 25,5 px sur un écran à trois pixels par point — toujours
  entre deux rangées.
- **Le papier n'est pas blanc.** Un blanc pur est un écran, pas une feuille.
  `PAPER_COLORS` porte le blanc cassé du fond et le gris chaud du réglage, pour
  l'écran comme pour l'export — une page imprimée doit ressembler à celle qu'on
  avait sous les yeux. Un gris bleuté sur du crème jure : les deux couleurs se
  choisissent ensemble.
- **Une sonde qui cherche une couleur écrite en dur rouille.** Celle de
  `fonds-e2e.mjs` comptait les traits de réglage d'un PDF en cherchant
  `0.84 0.84 0.86` ; le jour où le papier est passé au blanc cassé, elle a
  accusé l'export d'avoir perdu le réglage. Elle lit désormais la couleur
  **dans l'application** avant de la chercher dans le PDF.
- **Un fichier téléversé ne part pas tout seul.** Un document importé et une
  photo vivent sur le disque ; le bloc n'en garde que le nom. Supprimer la note,
  le bloc ou la page les laissait derrière — invisibles, et jamais repris.
  `lib/note-uploads.ts` s'en charge, avec les deux précautions de
  `deleteUnreferencedUploads` : **après** l'écriture en base, et seulement si
  plus aucun bloc ne s'en sert — dupliquer une page manuscrite donne deux blocs
  qui désignent le même fichier.
- **Une photo est une *page*, pas un bloc d'image.** C'est ce qui lui donne le
  stylet, le surligneur, le zoom, le volet des pages et l'export sans qu'on ait
  rien à réécrire. La pile compte donc **trois** genres de page — du document,
  ajoutée, photographiée — et en oublier un est l'erreur naturelle. `pageKind`
  existe pour cela, et le typage l'attrape : une branche manquante ne compile
  pas, parce que `BlankPage` et `ImagePage` n'ont pas les mêmes champs.
- **pdf-lib n'embarque que le JPEG et le PNG.** Les photos de note sortent donc
  du recadreur en **JPEG**, là où celles des cartes restent en WebP — qui pèse
  un tiers de moins mais qu'aucun PDF ne sait lire. Et la définition est plus
  grande (2400 px contre 1600) : on zoome jusqu'à six fois sur une page annotée.
- **L'encre suivait le thème de l'app, pas le papier.** En thème sombre le
  stylo écrit en blanc : on annotait donc un polycopié blanc à l'encre blanche,
  et une photo claire de même. Le défaut existait déjà sur les documents
  importés, sans que rien ne le signale — aucun audit ne regarde la couleur
  d'un trait posé sur une image. Règle désormais : **une surface qui porte des
  pages est du papier** et prend les valeurs claires dans les deux thèmes
  (classe `.ink-clair`), y compris pour les pages ajoutées au milieu, qui
  doivent ressembler à leurs voisines. Une surface sans pages, elle, continue
  de suivre le thème. La sonde mesure la couleur **réellement peinte** sur les
  tuiles, pas la variable CSS.
- **`npm run build` affiche « Compiled successfully » *avant* de typer.** Un
  `grep -c "Compiled successfully"` annonce donc un succès sur un build qui
  échoue au typage — et l'on part chercher ailleurs pourquoi le serveur sert un
  vieux code, voire pourquoi `.next` a disparu. **Se fier au code de sortie.**
- **Un PWA ne peut pas figurer dans la feuille de partage d'iOS.** Ni
  `share_target` ni `file_handlers` n'existent sur iOS ni iPadOS : Safari ne
  sait pas faire d'une application web la destination d'un partage ou d'un
  « Ouvrir avec ». Les déclarer ne coûte rien — Android, ChromeOS et les
  navigateurs de bureau s'en servent — mais il ne faut pas les annoncer comme
  une solution sur iPad. Ce qui marche là-bas, c'est le **glisser-déposer
  depuis Fichiers**, disponible depuis iPadOS 15 et limité à des types
  « standard » qui comprennent justement `.pdf`, `.docx` et `.doc`.
  `DepotDocument` écoute donc la **fenêtre** — viser un rectangle avec un
  fichier au bout du doigt est une épreuve d'adresse inutile — et refuse le
  comportement par défaut du survol, sans quoi le navigateur ouvre le PDF au
  lieu de nous le donner.
- **Une feuille de partage navigue, elle n'appelle pas.** Elle envoie le
  fichier et attend **une page** ; le glisser-déposer, lui, appelle en XHR et
  attend du JSON. La même route sert les deux et les distingue à l'en-tête
  `Accept` — répondre du JSON à un partage laisserait la personne devant une
  réponse brute au lieu de sa note, y compris en cas de refus.
- **Un tracé qui s'interrompt a trois causes, et aucune n'est dans le code du
  tracé.** Elles se cumulaient, et aucune ne se reproduit sur un navigateur de
  bureau :
  1. **La couche vive présentée en double tampon.** Elle demande la latence la
     plus basse possible (`desynchronized`), ce qui autorise le navigateur à
     alterner deux surfaces d'affichage : rien ne garantit alors qu'on retrouve
     d'une image à l'autre ce qu'on y a laissé. Ne repeindre que la **queue** du
     trait répartissait celui-ci entre deux tampons — il revenait en pointillé.
     **Une image doit se suffire à elle-même** ; tout repeindre coûte un quart
     de milliseconde pour trois mille points, il n'y avait rien à gagner.
     Chromium préserve le tampon et ne reproduit donc jamais le défaut : la
     sonde de `ecriture-e2e.mjs` efface la couche **sous** l'application au
     milieu du trait, pour éprouver l'invariant au lieu d'espérer le navigateur.
  2. **`pointercancel`.** iPadOS retire le pointeur du stylet pour des raisons
     qui n'ont rien à voir avec l'intention d'arrêter d'écrire : la main qui se
     pose et déclenche le rejet de la paume **du système**, un geste de bord,
     une rotation, une notification — et la pointe reste sur le verre. Traiter
     cela comme une fin de trait coupe le mot en deux. Le trait est donc mis en
     attente, et repris si la pointe redescend dans les 140 ms à moins d'un
     centième de largeur de page. Et pour que l'annulation n'arrive pas :
     pendant le tracé, `lib/palm.ts` refuse **tout** geste tactile au niveau du
     document, avec un chien de garde pour que la barrière retombe toujours.
  3. **Scribble.** La reconnaissance d'écriture d'iPadOS surveille le stylet
     partout, pas seulement dans les champs de texte, et **avale** les contacts
     qu'elle croit reconnaître : Apple l'a documenté — trois `pointerdown` reçus
     au lieu de quatre sur « Hello how are you »
     (<https://bugs.webkit.org/show_bug.cgi?id=217430>). Le contournement publié
     est un écouteur `touchmove` **non passif** qui refuse le comportement par
     défaut, posé une fois pour toutes sur la surface — Scribble décide avant
     que le premier `pointerdown` ne parvienne à la page. `passive: false` est
     indispensable, et c'est précisément ce que React ne fait pas : d'où
     l'écouteur natif.
- **La pression du stylet était ignorée.** `perfect-freehand` *simule* la
  pression par défaut, à partir de la vitesse du geste, et cette simulation
  **remplace** celle que le stylet a mesurée : le trait sortait trois fois trop
  fin — 2,0 px pour 5,3 demandés — et changeait d'épaisseur au moment où l'on
  levait la pointe, la couche vive et la couche fixe ne calculant pas la même
  chose sur un morceau de trait et sur le trait entier. C'est ce qui rendait
  l'écriture « granuleuse ». On ne la coupe pas pour autant : une souris et un
  doigt n'ont pas de pression. La règle se tire des **données**
  (`hasRealPressure` dans `lib/ink.ts`), ce qui permet à l'écran et à l'export
  d'en décider pareil sans champ supplémentaire à enregistrer.
- **Mesurer un trait demande un geste de vraie main.** Avec des points
  régulièrement espacés — ou espacés selon une belle sinusoïde — une largeur
  déduite de la vitesse sort parfaitement constante, et le défaut se cache. Il
  faut le tremblement d'un échantillon à l'autre. Et la mesure qui l'attrape le
  mieux n'est pas l'épaisseur moyenne : c'est la comparaison entre **la couche
  vive et la couche fixe**, entre ce qu'on voit en écrivant et ce qui reste.
- **La paume se pose sur les commandes, pas seulement sur la feuille.** Le rejet
  de la paume existait sur le canevas ; la barre d'outils et le repère de page
  flottent en bas de l'écran, exactement là où la main repose. `lib/palm.ts` les
  protège avec deux critères qui se complètent : la **taille du contact**
  (`radiusX` / `radiusY` — une pulpe fait vingt à trente pixels, le tranchant
  d'une main cinquante à cent cinquante), seul critère valable quand la main se
  pose *avant* que la pointe ne touche ; et le **stylet en contact**, avec un
  délai de grâce. Rien de tout cela ne s'applique tant qu'aucun stylet n'a
  servi. Trois pièges : `touchstart` doit être déclaré **non passif** pour que
  `preventDefault` compte ; le clic de compatibilité survit à un
  `preventDefault` sur `pointerdown`, il faut donc une dernière barrière — mais
  **courte et localisée**, sans quoi elle mange le geste du doigt qui suit ;
  et `setPointerCapture` lève un `NotFoundError` si le pointeur a été relâché
  entre-temps, ce qui interrompait le tracé.
- **Compter des traits ne dit rien de leur forme.** Les contours ont été
  calculés un temps sur des coordonnées comprises entre 0 et 1 — ce qui
  paraissait naturel, les coordonnées l'étant déjà. Mais `getStroke` n'est
  **pas** invariant d'échelle : à cette taille, ses seuils internes de distance
  écartent presque tous les points et le trait devient une tache large de la
  moitié de la page — 881 unités de haut pour un trait qui en fait 1,6. Toutes
  les vérifications passaient : elles comptaient des traits, pas des pixels.
  Tout se calcule donc dans `INK_REF` (mille unités), et `ecriture-e2e.mjs`
  mesure désormais la **forme** d'un trait droit — longueur, épaisseur,
  surface — contre ce qu'elle devrait être.
- **Le zoom passe par la mise en page, jamais par `transform: scale()`.**
  Agrandir le canevas en CSS multiplie des pixels déjà tracés : l'écriture
  devenait crénelée dès trois fois. Le zoom change la **largeur de la page** ;
  les tuiles sont rasterisées à la taille affichée. La sonde mesure le rapport
  entre résolution et taille affichée : il doit rester égal à la densité de
  l'écran, alors qu'un agrandissement CSS le divise par le facteur de zoom
  (0,33 mesuré à 6×).
- **L'encre déjà posée vit dans la page, pas dans la fenêtre.** Un canevas
  collant redessiné à chaque événement de défilement fait disparaître
  l'écriture pendant le geste, puis la fait revenir rognée : la fenêtre bouge,
  le dessin non. Les traits vivent donc sur des **tuiles** placées en
  coordonnées de page, qui glissent avec le papier — faire défiler ne redessine
  rien, et `ecriture-e2e.mjs` exige **zéro** remplissage pendant un défilement.
  Le trait en cours, lui, est seul sur sa couche et ne repeint que sa queue :
  son coût par image ne dépend plus de sa longueur.
- **Le corps d'une action serveur est plafonné à un mégaoctet.** Next refuse la
  requête *avant* d'appeler le code : la promesse est rejetée, et un appel non
  protégé laisse l'interface en chargement pour toujours. C'est ce qui bloquait
  l'import de PDF sur iPad — un scan dépasse le mégaoctet dès deux pages — et
  ce qui perdait en silence l'enregistrement d'une page manuscrite dense
  (`MAX_BLOCK_BYTES` vaut deux mégaoctets). Le plafond est relevé dans
  `next.config.ts`, l'import passe par une route (`POST
  /api/notes/<id>/document`) qui n'en a pas et dont l'envoi se mesure en XHR, et
  **tout appel d'action est désormais protégé** : une promesse rejetée doit
  rendre la main.
- **Un PDF servi sans `Accept-Ranges` est téléchargé en entier.** pdf.js ne
  demande que ce qu'il affiche — si le serveur répond 206. Sans cela, ouvrir un
  polycopié scanné de trente mégaoctets attend les trente mégaoctets avant la
  première page, ce qui ressemble à un blocage. Et le format des pages se relève
  **au serveur**, à l'import : le faire dans le navigateur retéléchargeait le
  document entier juste après l'avoir envoyé.
- **iPadOS sélectionne le texte sur un appui maintenu.** Au milieu d'une
  phrase, toute la page passait en surbrillance. Il faut `user-select: none`,
  `-webkit-touch-callout: none` (classe `.ink-surface`) **et**
  `preventDefault()` dès `pointerdown` : la décision du geste est prise avant le
  premier mouvement. Chromium ne connaît pas `-webkit-touch-callout` : il la
  jette à l'analyse, donc elle est invisible au style calculé comme à
  `cssText` — la sonde relit la feuille **telle qu'elle est livrée**.
- **Une page manuscrite simple n'est pas une pile, et cela lui coûtait sa
  feuille.** Une surface neuve a `pages: []` ; `insertPage` rendait le contenu
  inchangé et la palette masquait le bouton (`canAddPage` exigeait
  `pages.length > 0`). Il n'y avait donc **aucun** moyen d'ajouter une page à
  celle sur laquelle s'ouvre chaque note neuve, ni à un croquis ajouté à la
  main. La réponse d'alors — « pour une page de plus, ajoute un bloc » — n'est
  pas la même chose : un bloc est une autre surface, avec sa palette, sans
  annotation à cheval et sans numéro de page. `insertPage` passe maintenant par
  `enPile`, comme le faisaient déjà `insertImagePage` et `insertDocumentPages`.
- **Une photo n'est pas un format à imiter.** La feuille ajoutée reprenait le
  format de sa voisine — juste dans un polycopié A4, absurde après un cliché en
  paysage : on se retrouvait à écrire sur une bande deux fois plus large que
  haute. `formatDeFeuille` saute les pages image et prend le papier le plus
  proche, à défaut `DEFAULT_RATIO`.
- **La hauteur du canevas ne dit rien du nombre de pages.** La fenêtre d'une
  page manuscrite est bornée à l'écran (`100svh` moins le reste) et c'est la
  surface qui défile dedans : une sonde qui mesurait `getBoundingClientRect()`
  voyait 757 px avant comme après l'ajout et accusait l'application. Mesurer
  `scrollHeight / clientWidth` sur `[data-ink-scroll]`, ou lire les pages dans
  la base du bac à sable.
- **Une feuille glissée au milieu décale tout ce qui suit.** Les traits sont
  repérés d'un bout à l'autre de la pile — c'est ce qui permet d'annoter à
  cheval sur deux pages — donc ajouter une page au milieu d'un polycopié doit
  faire **descendre avec leur page** toutes les annotations qui suivent
  (`insertPage` / `removePage` dans `lib/notes.ts`, et l'inverse au retrait).
  Sans cela chacune tombe sur la page d'à côté, et rien à l'écran ne le dit.
  L'appartenance d'un trait se décide par son **milieu**, la même règle qu'à
  l'export : deux règles différentes donneraient deux réponses.
- **Le fond d'une page appartient à la page.** Une pile peut mêler des pages du
  document et des pages ajoutées ; chacune de ces dernières porte son propre
  fond, et le réglage part du haut de **sa** page. Un fond posé sur la surface
  entière ne tombait juste que sur la première.
- **Un fond dessiné en CSS n'existe pas à l'export.** Les lignes de l'écran
  sont un `repeating-linear-gradient` ; le PDF n'en sait rien, et une page à
  lignes en sortait blanche, l'écriture suspendue dans le vide. `PAPER_STEPS`
  (dans `lib/notes.ts`) est la **seule** source des interlignes : la feuille de
  style en tire ses pas, `paperGuides` les redessine en opérateurs PDF, et
  `tests/pages.test.ts` vérifie que les deux ne se séparent pas. Attention aux
  conventions du dégradé : la ligne se pose au **bas** de sa bande, et
  `radial-gradient` centre son point au **milieu** de sa tuile — compter depuis
  le coin décale la grille d'un demi-carreau.
- **Une propriété personnalisée non déclarée n'est pas mesurable.** Sa valeur
  calculée reste la suite de jetons écrite dans la feuille, pas une longueur :
  `getComputedStyle` rend `calc(var(--paper-width) * 0.033)`, et une sonde qui
  lit l'interligne n'y voit que « NaN ». Les deux propriétés du papier sont
  donc déclarées en `<length>` par `@property`. Et **ne jamais redéclarer sur
  l'élément une valeur qu'il doit hériter** : `.paper-ruled { --paper-width: … }`
  l'emportait sur celle que publiait la surface, et l'interligne restait figé
  au repli quel que soit le zoom. Le repli est l'`initial-value` de la
  déclaration, qui ne fait de l'ombre à personne.
- **`next start` sert le build qu'il a trouvé au démarrage.** Reconstruire sous
  un serveur qui tourne ne change rien à ce qu'il répond : une correction
  vérifiée en vain pendant une demi-heure, parce que le serveur rendait encore
  le défaut qu'on venait de réintroduire pour éprouver une sonde. **Relancer le
  serveur après chaque `npm run build`.**
- **Un document importé est *une* surface.** Ses pages sont empilées sur le
  même canevas, pas une par bloc : on fait défiler d'un geste, on annote à
  cheval, et la palette ne bouge pas. Les traits sont donc repérés d'un bout à
  l'autre de la pile, et l'export doit **rendre chaque trait à sa page**
  (`pageAtY` puis `translateStroke`) : sans ce retour au repère de la page, un
  trait de la page 2 sort du papier à y ≈ −290, ce qu'aucune mesure d'écran ne
  voit. Seules les pages proches de l'écran sont rendues — deux cents canevas
  pdf.js tuent l'onglet.
- **Deux classements, pas un.** Les dossiers portent un genre (`Folder.kind`,
  « deck » ou « note ») : créer un dossier pour ses notes en faisait apparaître
  un dans les paquets. Toute requête de dossier filtre donc sur le genre, et
  ranger une note dans un dossier de paquets est refusé — elle y deviendrait
  invisible.
- **Annuler annule une action, pas « le dernier trait ».** La pile d'annulation
  ne savait que retirer le dernier trait de la liste. Or la gomme, le déplacement
  d'une sélection et « Effacer toute la page » réécrivent la liste entière :
  après un coup de gomme, Annuler effaçait un trait **de plus**, et la page
  effacée ne revenait jamais. Le libellé « Annuler le dernier trait » disait
  exactement le défaut. L'historique garde maintenant des **instantanés du
  contenu** (`drawing-block.tsx`) ; les traits étant immuables, deux versions
  voisines partagent presque tout. Un contenu venu d'ailleurs — chargement,
  duplication — remet l'historique à zéro : `analyserDessin` garde l'identité de
  l'écho, donc « venu d'ailleurs » ne se déclenche pas à chaque trait.
- **Un toucher à deux doigts ressemble à une paume.** Deux contacts posés puis
  relevés en moins d'un quart de seconde, sans glisser : c'est le geste
  d'annulation, et c'est aussi la paume qui se pose juste avant la pointe et se
  relève aussitôt. Le stylet qui touche doit donc **oublier le toucher en
  observation**, pas seulement les doigts. Sans cela, l'annulation tombait en
  plein tracé et **des traits étaient perdus**, jusque dans la note enregistrée :
  mesuré à 3 traits au lieu de 5, rechargement compris. On avait supposé que le
  canevas, qui refuse un contenu extérieur pendant un tracé, protégerait le
  compte et que seul l'historique serait faussé — la mesure a dit le contraire.
  `historique-e2e.mjs` vérifie donc le compte **et** Annuler juste après.
- **Seul le pointeur qui a commencé un geste peut le terminer.** Corriger
  l'annulation involontaire a révélé un défaut plus ancien : un doigt posé avant
  la pointe et relevé pendant le tracé traversait `onPointerUp` jusqu'au bout,
  et terminait **le trait du stylet** — réduit à un point, donc jeté. La main
  posée juste avant d'écrire effaçait le mot. Le canevas retient donc l'auteur du
  geste (`auteur`), ignore le lever de tout autre pointeur, et l'oublie quand un
  `pointercancel` met le trait en attente — sinon, l'attente expirée, il ferait
  ignorer le lever du pointeur suivant.
- **Une couleur de trait passe par quatre traductions.** Un trait enregistre sa
  couleur en texte : un nom d'encre, que la feuille de style traduit selon le
  papier et le thème, ou depuis la roue un `#rrggbb`. La couche vive, les tuiles,
  la vignette et l'export PDF la traduisaient chacun de leur côté, et l'export
  aurait sorti en **noir** toute couleur libre (`inkRgb` retombait sur l'encre
  par défaut). Tout passe désormais par `lib/ink-color.ts`. Une couleur libre
  n'a qu'une teinte : elle ne s'éclaircit pas en thème sombre, contrairement aux
  six encres nommées — c'est un choix, et `couleur-e2e.mjs` le vérifie.
- **Une image glissée dans une pile s'insère au client, pas au serveur.** Le
  serveur (`uploadPageImage`) n'enregistre que le fichier. S'il insérait
  lui-même la page, l'enregistrement différé du client — parti d'une version
  sans la photo — écraserait le bloc, et `updateBlock` supprimerait le fichier en
  le croyant retiré. Insérée au client, la page passe par l'historique : Annuler
  la retire, et l'enregistrement suivant nettoie le fichier. Une page manuscrite
  simple devient pour cela une pile (`insertImagePage`) : sa surface forme la
  première page, et ses traits ne bougent pas.
- **L'aperçu d'une note est sa première page qui montre quelque chose.** Il
  était tiré de « la première page manuscrite » tout court. Le jour où la note
  neuve s'est ouverte sur une page vierge, tout polycopié ou photo importé
  **après** elle a laissé la vignette vide — `buildPreview` rend `null` pour une
  page sans trait ni image. `vignettes-e2e.mjs` l'a vu ; retirer la page vierge
  dans le script l'aurait caché. La règle vit dans `notePreview` (lib/notes.ts),
  qui lit les pages **à la demande** et s'arrête à la première utile : l'aperçu
  est recalculé à chaque enregistrement, et relire toutes les pages chaque
  seconde chargerait la note entière. Supprimer ou réordonner des blocs le
  recalcule aussi. Même règle **dans** une pile : une page vierge suivie d'une
  photo glissée depuis la barre montre la photo.
- **Une note neuve s'ouvre sur une page manuscrite.** Les scripts qui écrivaient
  dans « le paragraphe de la note neuve » doivent d'abord l'ajouter (bouton
  « Texte »), et ceux qui ajoutent un « Croquis » trouvent désormais **deux**
  canevas : un sélecteur sans `.first()` ni `.last()` échoue en mode strict.
- **Les flux d'un PDF exporté sont compressés.** `couleur-e2e.mjs` cherchait
  la couleur choisie dans les octets bruts du PDF, n'y trouvait **aucune**
  couleur — pas même le fond du papier — et accusait l'export. L'export était
  juste : les flux de contenu sont en `FlateDecode`. Décompresser d'abord
  (`inflateSync`, ou `decodePDFRawStream` comme `fonds-e2e.mjs`). Une mesure qui
  ne trouve rien du tout doit faire douter de la mesure avant l'application.
- **`aria-hidden` cache aussi tout ce qu'il contient.** Le carré de saturation
  de la roue portait `aria-hidden`, son dégradé étant décoratif — et la poignée
  « Saturation et luminosité » vivait dedans : un curseur tabulable, visible,
  mais absent de l'arbre d'accessibilité. `audit.mjs` passait sans rien dire, il
  ne mesure que ce qu'il peut trouver. C'est `couleur-e2e.mjs`, qui cherche la
  poignée **par son rôle**, qui l'a vu. Décoratif se met sur une feuille de
  l'arbre, jamais sur un conteneur.
- **Deux couches fixes au même z-index : la dernière du document gagne.** La
  barre de navigation du téléphone est en `z-40`, le plein écran l'était aussi,
  et la barre vient après la note : elle cachait la moitié de la palette. Rien
  ne le signalait, toutes les captures du plein écran étant prises en largeur
  d'iPad, où la barre n'existe pas. Le plein écran est donc en `z-50`, et
  `telephone-e2e.mjs` vérifie que chaque bouton de la palette est bien le
  premier élément sous son propre centre.
- **Un plafond de densité pensé pour l'iPad floute le téléphone.** Deux pixels
  par point suffisent sur iPad ; un iPhone en a trois, et une page de PDF déjà
  large de 330 px y sortait aux deux tiers de l'écran. Le rendu PDF suit
  désormais la densité réelle jusqu'à trois — `SIDE_MAX` borne le reste. L'encre
  garde son plafond (`DPR_MAX`) : c'est elle qui pèse en mémoire vidéo.
- **Un état que React connaît ne se dit pas en CSS.** Le repère de page devait
  monter quand le canevas passe en plein écran ; la règle `html[data-…] .x`
  vivait dans `@layer components` et perdait contre `md:bottom-6`, qui est un
  utilitaire. Remonter le drapeau en état React a réglé la chose en trois
  lignes. La couche `components` sert à ce qu'un utilitaire **doive** pouvoir
  écraser — pas à ce qui doit gagner.
- **Ce que le `postinstall` touche doit être dans l'image.** npm l'exécute à la
  fin de `npm ci`, avant le `COPY . .` : il a fallu copier `prisma/` d'abord,
  puis `scripts/` le jour où le `postinstall` s'est mis à copier le worker de
  pdf.js — « Cannot find module /app/scripts/copy-pdf-worker.mjs », au
  déploiement seulement. `tests/dockerfile.test.ts` **relit** la ligne de
  `postinstall` et exige que chaque chemin qui y figure soit copié avant
  l'installation : ajouter un script sans toucher au Dockerfile fait échouer le
  test, pas le serveur.
- **`npm prune` trébuche sur les paquets d'une autre plateforme.** Il parcourt
  l'arbre du verrou et s'arrête sur ce qui y figure sans être sur le disque —
  `ENOENT: lstat …/@tailwindcss/oxide-wasm32-wasi`, le repli WebAssembly que
  Linux n'installe pas. L'image obtient donc son arbre de production par
  `npm ci --omit=dev`, qui repart du verrou au lieu de retrancher.
- **Verrou npm et version de npm.** Deux npm différents n'écrivent pas le même
  `package-lock.json` : npm 11 omet des dépendances de paquets optionnels —
  `@emnapi/runtime`, réclamé par `@img/sharp-wasm32` — que npm 10 exige. Le
  `npm ci` du `Dockerfile` s'arrête alors sur « Missing: … from lock file »,
  alors que tout passe sur la machine de développement. Le déploiement a échoué
  deux fois là-dessus. La version vit désormais dans `packageManager`
  (package.json), le `Dockerfile` l'impose avant `npm ci`, et
  `tests/lockfile.test.ts` vérifie sans npm que chaque dépendance citée par le
  verrou s'y résout. **Régénérer un verrou se fait avec la version déclarée**,
  et npm 11 au minimum : il relit un verrou de npm 10, l'inverse est faux.
- **Une hauteur en pixels ne connaît pas l'orientation.** La fenêtre d'une page
  manuscrite était plafonnée à 520 px : cela remplissait un iPad en paysage, et
  laissait en portrait un document coupé au-dessus de 360 px de vide. Sur un
  iPhone en paysage, elle dépassait même l'écran. Elle suit désormais `100svh`
  moins `--ink-chrome` et la palette — `svh`, pas `innerHeight`, qui bouge
  quand Safari replie ses barres. Et le plein écran mesurait sa hauteur **une
  fois**, à l'ouverture : tourné, il gardait celle de l'autre orientation. Toute
  mesure de place disponible s'observe (`ResizeObserver`), elle ne se prend pas.
- **Un élément invisible refuse le focus, sans rien dire.** Le menu contextuel
  reste en `visibility: hidden` le temps d'être mesuré ; le focus donné à ce
  moment-là n'arrivait nulle part, et Échap n'atteignait plus le menu. Le focus
  se donne **après** le placement.
- **Un élément mesuré là où il sera placé mesure la place qu'il y a.** Posé à
  l'abscisse du bouton ⋮, au bord droit de l'écran, le menu se rétrécissait à sa
  largeur minimale ; placé sur cette largeur, il reprenait la sienne et
  débordait. On le mesure depuis le coin de l'écran.
- **iPadOS n'émet pas `contextmenu` sur un appui long** : Safari y montre
  l'aperçu du lien. L'appui long est refait sur Pointer Events
  (`components/context-menu.tsx`), l'aperçu neutralisé par
  `-webkit-touch-callout: none`, et le clic qui suit le lever du doigt avalé —
  mais pas au-delà de 400 ms, iPadOS n'émettant pas toujours ce clic : le
  drapeau aurait sinon mangé le premier choix fait dans le menu.
- **Le mode strict ne pardonne pas une ressource libérée au nettoyage d'un
  effet.** En développement, React démonte puis remonte chaque composant **en
  gardant son état**. Le recadreur créait l'URL de la photo dans l'état et la
  révoquait au démontage : au remontage, l'état désignait une URL morte, et la
  boîte montrait « Photo à recadrer » à la place de l'image. Aucune vérification
  ne l'a vu — elles tournent sur le build de production, qui ne remonte rien.
  Un défaut signalé depuis `localhost:3000` se reproduit **sur le serveur de
  dev**, pas sur celui du port 3100.
- **Un nom de bouton se compare par sous-chaîne.** `getByRole("button", { name:
  "Document" })` trouve aussi « Ajouter une photo, une image ou un document » :
  renommer un bouton a fait échouer deux scripts en mode strict. Un nom court se
  cherche avec `exact: true`.
- **Le hors ligne est une page, pas un cache de pages.** L'app est rendue au
  serveur et multi-comptes : le service worker ne met en cache **aucune** page
  qui porte des données. Les paquets et les notes gardés vivent dans IndexedDB
  (`lib/hors-ligne/`), et une navigation qui ne trouve pas le serveur est
  renvoyée vers `/offline?de=<adresse>` — une page statique, sans donnée, qui
  lit l'appareil et retrouve l'intention (`lireDestination`). Ses liens restent
  les vraies adresses de l'app.
- **Hors ligne, un lien de Next ne mène nulle part.** La navigation côté client
  demande au serveur la charge de la page suivante et reste suspendue. Hors
  ligne franc, les liens internes partent donc en navigation complète
  (`lienADetourner`), que le service worker sait servir.
- **La page hors ligne ne cite pas tous ses scripts.** Son HTML ne nomme que
  ceux de son premier affichage ; pdf.js, chargé à la demande, n'y figure pas.
  La coquille met donc en cache le build entier (`/api/hors-ligne/coquille`,
  moins de deux mégaoctets) et le worker de pdf.js, et le service worker
  rejoue lui-même les requêtes **par plage** depuis un fichier en cache :
  pdf.js attend un 206.
- **Mettre à jour le worker ne doit pas vider l'iPad.** L'activation effaçait
  tout cache autre que la version courante — y compris, désormais, les
  polycopiés gardés et la coquille. Seuls les caches `fiches-v*` partent ;
  `tests/hors-ligne.test.ts` exécute le worker pour le vérifier.
- **Une réponse de révision est un fait daté, pas un état.** Rejouée par la
  file après une confirmation perdue, une réponse comptait double. Chacune
  porte un identifiant choisi par l'appareil (`ReviewAnswer`), et la plus
  récente décide de la date de retour : une réponse plus ancienne que la
  dernière connue compte dans les statistiques sans replanifier la carte. Tout
  passe par `lib/revision.ts` — l'action du web et l'API mobile avaient chacune
  leur copie du calcul.
- **La copie gardée d'une note ne prend que ce que le serveur a confirmé.**
  Mise à jour à chaque frappe, elle aurait porté des brouillons non envoyés ;
  or à la réouverture, `useSauvegarde` tient pour « déjà en base » tout
  brouillon identique au contenu reçu, et l'efface. Et **pas** mise à jour du
  tout, elle restait à la dernière synchronisation : écrire en cours puis
  partir dans la minute ouvrait une copie ancienne, dont l'enregistrement
  aurait écrasé au serveur la fin du cours. D'où `blocConfirme`, branché sur
  la confirmation.
- **« Disponible hors ligne » se dit une fois tout descendu.** L'épingle était
  marquée résolue avant ses fichiers : la pastille paraissait, on partait, et
  le second polycopié du dossier s'ouvrait sur « Document illisible ». En
  local, les fichiers arrivent en quelques millisecondes et la sonde ne voyait
  **jamais** le défaut — elle ne l'a attrapé qu'une fois les téléchargements
  ralentis par `context.route`. Un ordre d'arrivée se prouve sur un réseau
  lent, pas sur `localhost`.
- **Attendre une file vide en relisant, pas en espérant.** Une attente qui
  interrogeait IndexedDB par `waitForFunction` a conclu « file vide » avant
  l'envoi ; le contrôle en base est passé trop tôt et la sonde accusait l'app
  d'avoir perdu deux réponses, que la trace montrait bien arrivées. Les scripts
  hors ligne relisent en boucle (`attendre`).
- **`/notes` n'est plus un exemple de page indisponible hors ligne.** Un script
  qui veut la page « a besoin du serveur » vise `/admin`.
- **Tri de texte en SQLite.** La comparaison est octet par octet : « Écrite »
  se range après « Note », parce que « É » s'encode sur deux octets dont le
  premier vaut plus que « N ». Aucune collation française sans extension — trier
  en mémoire après un listing borné.
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
- **Un enregistrement qui échoue doit revenir, pas s'annoncer.** L'éditeur
  envoyait chaque modification **une fois** ; en cas d'échec il affichait un
  message, et le contenu ne vivait plus que dans la mémoire de l'onglet. Le
  sort du travail dépendait alors du hasard : si l'on écrivait à nouveau juste
  après la coupure, l'enregistrement suivant rattrapait tout ; sinon rien ne
  repartait jamais. La règle est désormais celle d'un journal d'écriture
  anticipée : **rien ne part au réseau avant d'être posé sur l'appareil**
  (`lib/brouillons.ts`, IndexedDB), **rien n'en sort avant que le serveur n'ait
  confirmé**, et la file (`lib/sauvegarde.ts`) rejoue avec un délai croissant.
  Rouvrir la note remet en place ce qui n'était jamais parti.
- **Confirmer n'autorise pas à effacer.** L'aller-retour dure quelques
  centaines de millisecondes et la main n'attend pas : deux mots de plus sont
  posés entre l'envoi et sa confirmation. Effacer le brouillon sur confirmation
  jetterait précisément ces deux mots, que le serveur n'a jamais vus. D'où le
  rang d'écriture (`seq`) : on n'efface que si rien n'a été écrit depuis.
- **Un échec doit se nommer.** « Le réseau a coupé », « la session a expiré » et
  « ce bloc est trop volumineux » demandent trois conduites opposées — réessayer
  en silence, demander de se reconnecter, arrêter de réessayer — et une action
  serveur rejetée ne dit laquelle. D'où la route `PUT
  /api/notes/<note>/blocks/<bloc>`, qui rend un code HTTP. Son cœur vit dans
  `lib/note-save.ts` et **pas** dans le fichier d'actions : il prend un
  `userId`, et une telle fonction exportée d'un module « use server » serait
  appelable par le client avec le compte de son choix.
- **Une redirection n'est pas un enregistrement.** Suivie, une redirection vers
  `/login` rend la page de connexion avec un 200 : `response.ok` est vrai, et
  l'app annoncerait avoir enregistré sa page dans un écran de login — le même
  piège que le jeton périmé, côté application cette fois. L'envoi se fait donc
  en `redirect: "manual"`, où une redirection arrive avec le statut 0 et se voit.
- **`navigator.onLine` doit être branché, sinon tout se ressemble.** La file
  distingue « pas de réseau » d'« une requête qui échoue sur un réseau
  présent » ; faute d'avoir passé `enLigne`, une coupure franche se présentait
  comme « Reprise en cours ». Couper une requête dans Playwright
  (`route.abort`) n'éprouve donc **pas** le hors-ligne : il faut
  `context.setOffline(true)`, qui seul émet l'événement `online`.
- **`tertiary-container` tire au rose, à un cheveu de `error-container`.**
  « Hors ligne » se résout tout seul au retour du réseau ; le peindre comme une
  alarme fait craindre une perte au moment précis où l'app garantit qu'il n'y en
  aura pas. L'attente est en `secondary-container`, l'alarme reste pour ce qui
  demande un geste. Aucune mesure ne le dit — les deux passent le contraste.
- **Un choix logé derrière un indicateur masqué n'existe pas.** Les brouillons
  qu'on ne s'autorise pas à remettre d'office — la note a changé depuis — vivaient
  dans le panneau qu'ouvre la pastille d'enregistrement. Or cette pastille est
  masquée quand tout est enregistré, ce qui est précisément leur cas : ils
  n'attendent pas un envoi mais une décision. Le choix était donc invisible pour
  toujours. Il s'affiche maintenant **dans la note**. Trouvé en écrivant le
  scénario, pas en relisant le code : le script ne pouvait pas cliquer la
  pastille, et c'était la bonne raison.
- **Une pastille à enfants échappe à `audit.mjs`.** La sonde saute les éléments
  qui ont des enfants (icône + libellé + compteur) et ceux dont l'opacité est
  nulle. Un indicateur qui n'apparaît que sous condition n'est donc jamais
  examiné : `regard-sauvegarde.mjs` le mesure état par état.
- **`page.evaluate` avec une chaîne ignore son argument.** Playwright évalue la
  chaîne comme une expression ; un `(sel) => {…}` passé ainsi rend une fonction,
  jamais son résultat, et la sonde annonce « introuvable » sans rien avoir
  cherché. Écrire une expression auto-appelée, comme le fait `audit.mjs`.
- **Un identifiant de note codé en dur rouille.** `telephone-e2e.mjs` vise
  `PDF_NOTE`, une note qui n'existe plus dès que `verify/verif.db` est recopié
  depuis `data/dev.db` : le script échoue sur un délai d'attente qui accuse
  l'application. Il accepte `PDF_NOTE=<id>` en variable d'environnement — y
  passer une note qui porte un document.
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
cp data/dev.db verify/verif.db
rm -rf verify/uploads && mkdir -p verify/uploads && cp -R data/uploads/. verify/uploads/
DATABASE_URL="file:$PWD/verify/verif.db" UPLOAD_DIR="$PWD/verify/uploads" \
  npx next start -p 3100
```

Copier la base **sans ses fichiers** donne une copie incomplète : les notes qui
portent un document importé s'ouvrent alors sur un 404, et le rendu PDF échoue.
Ce n'est pas un défaut de l'application, c'est un bac à sable mal rempli.

Cinq images d'essai se sont retrouvées dans `data/uploads` avant que ce soit
noté ici.
