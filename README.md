# Fiches

Cartes de révision auto-hébergées : un paquet par cours, des cartes
question / réponse avec image, et un mode révision en deux piles — *je savais*
d'un côté, *à revoir* de l'autre. Installable comme une application sur
téléphone (PWA). Multi-comptes, sans inscription publique, sans IA.

**Pile technique** — Next.js 16 (App Router, Turbopack), React 19, Prisma +
SQLite, Tailwind CSS v4, Radix UI, Motion.

Les polices (Bricolage Grotesque pour les titres, Inter pour le texte) sont
**auto-hébergées** dans `public/fonts` : aucun appel réseau au build, donc
`docker build` fonctionne sur une machine sans accès sortant. Le sous-ensemble
`latin` couvre entièrement le français. Pour en changer, remplacer les `.woff2`
et ajuster `src/app/fonts.ts`.

L'icône de la PWA est générée par `npm run icons` à partir du même dessin que
`src/components/logo.tsx` — modifier l'un implique de relancer l'autre.

---

## Comment les données sont réparties

| Donnée | Où elle vit | Pourquoi |
|---|---|---|
| Base SQLite | disque **local** du Xubuntu | SQLite se corrompt sur un partage NFS/SMB : le verrouillage de fichiers n'y est pas fiable |
| Images des cartes | **NAS**, en bind mount | Fichiers indépendants, aucun problème sur un partage réseau |
| Sauvegardes de la base | **NAS**, une par nuit | Contrepartie de la base locale : le NAS reste la copie de référence |

Le Xubuntu fait tourner l'application et sert de pont ; le NAS porte les
données lourdes et les sauvegardes.

---

## Installation sur le Xubuntu

Procédure détaillée, pas à pas et vérifiable : **[INSTALL.md](INSTALL.md)**.
Elle est rédigée pour être suivie littéralement, y compris par un agent IA.

En résumé :

```bash
git clone <ton-dépôt> fiches && cd fiches
./scripts/install.sh
```

Le script installe Docker si besoin, vérifie que le partage NAS est monté,
génère un `.env` avec un `SESSION_SECRET` aléatoire, construit l'image,
démarre le conteneur, crée le premier compte administrateur et propose un
timer systemd pour la sauvegarde nocturne. Il est idempotent : on peut le
relancer sans rien casser.

L'app écoute alors sur `127.0.0.1:3002` — **boucle locale uniquement**. Pour y
accéder depuis un autre appareil, voir la section suivante.

### Accès depuis le réseau

Le cookie de session est marqué `Secure` et les service workers exigent HTTPS.
Sans HTTPS, l'app fonctionne en local mais n'est ni installable en PWA ni
protégée en transit. Trois chemins, du meilleur au plus rustique :

**Tailscale — recommandé si tu veux réviser sur ton téléphone.** Certificat
public reconnu, aucune autorité à installer sur les appareils, et ça marche
aussi hors du domicile.

```bash
sudo tailscale up
sudo tailscale cert fiches.<ton-tailnet>.ts.net
sudo apt install caddy
# décommenter l'option A de Caddyfile.example, la copier dans /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

**Caddy avec certificat interne — LAN seul.** Voir l'option B de
[Caddyfile.example](Caddyfile.example). Il faut installer la racine de Caddy
sur chaque appareil, sinon le navigateur refuse d'installer la PWA.

**HTTP simple — dépannage seulement.** Mettre `COOKIE_SECURE=false` dans
`.env` et publier le port sur le LAN en remplaçant `127.0.0.1:${APP_PORT}:3000`
par `${APP_PORT}:3000` dans `docker-compose.yml`. Les mots de passe circulent
alors en clair sur le réseau local, et la PWA n'est pas installable.

---

## Comptes

L'inscription est fermée. Le premier administrateur est créé par le script
d'installation ; ensuite tout se passe depuis la page **Comptes** (icône
bouclier dans l'en-tête, visible des seuls administrateurs).

En ligne de commande, dans le conteneur :

```bash
# créer un compte, ou réinitialiser le mot de passe d'un compte existant
docker compose exec app npx tsx scripts/create-user.ts \
  --email camille@exemple.com --name Camille [--admin]
```

Le mot de passe est demandé de façon interactive, ou fourni par la variable
`FICHES_PASSWORD` — jamais en argument, `argv` étant lisible par tous les
processus de la machine.

---

## Organiser : dossiers et paquets

L'accueil montre ce qui n'est rangé nulle part ; les dossiers regroupent le
reste. Ils s'imbriquent jusqu'à **5 niveaux**, borne d'interface destinée à
garder le fil d'Ariane lisible.

- **Nouveau dossier** crée un sous-dossier là où tu te trouves.
- **Glisser-déposer** : à la souris, un paquet se prend et se dépose sur un
  dossier, ou sur un maillon du fil d'Ariane pour le faire remonter. Le
  glisser-déposer natif du navigateur ne fonctionne pas au doigt — c'est une
  limite de l'API, pas un oubli ; sur tactile et au clavier, l'icône de
  déplacement fait le même travail.
- L'icône de déplacement range un paquet ou un dossier ailleurs. Un dossier ne
  peut pas être déplacé dans lui-même ni dans l'un de ses descendants : la
  branche entière deviendrait inaccessible, et le serveur le refuse.
- **Supprimer un dossier** emporte ses sous-dossiers mais **jamais les paquets**
  qu'ils contiennent : ceux-ci remontent à l'accueil. C'est délibéré — jeter un
  classeur ne doit pas détruire le travail.

---

## Écrire les cartes

La page d'un paquet **est** l'éditeur : toutes les cartes y sont visibles et
modifiables en place, sans boîte de dialogue.

- **Enregistrement automatique** à la sortie de chaque champ, avec un
  indicateur discret. Rien à valider.
- **Réordonner** : la poignée à droite se glisse à la souris comme au doigt.
  Les flèches ↑ ↓ font la même chose au clavier, et restent plus commodes sur
  un long paquet.
- La barre de mise en forme (**gras**, *italique*, listes…) n'apparaît que
  lorsqu'un champ a le focus, pour que la liste reste lisible.
- L'image se rattache directement depuis la ligne, et s'agrandit au clic.

**Photographier une fiche.** Sur iPad et téléphone, un bouton **Appareil
photo** ouvre l'appareil du système, puis un recadreur : on déplace le cadre
ou on tire ses coins, on peut pivoter par quarts de tour, et les flèches du
clavier déplacent le cadre. Le bouton n'apparaît que sur écran tactile
(détecté par `pointer: coarse`, sans reniflage d'agent utilisateur).

L'accès passe par `capture="environment"` sur un champ fichier, donc par
l'application appareil photo du système, et non par `getUserMedia` : il
faudrait sinon réimplémenter mise au point, exposition et flash, sans accès au
traitement d'image de l'iPad.

Le recadrage sert aussi à **alléger** : la photo est réencodée en WebP et
bornée à 1600 px de côté. Un cliché d'iPad passe ainsi de plusieurs mégaoctets
à quelques dizaines de kilooctets — ce qui compte quand les images vivent sur
le NAS.

**Deux conditions pour que l'appareil photo fonctionne**, l'une et l'autre
faciles à casser sans s'en apercevoir :

1. L'en-tête `Permissions-Policy` doit contenir `camera=(self)`. La valeur
   vide, `camera=()`, interdit l'appareil photo à l'application elle-même —
   sans le moindre message d'erreur. Un test (`headers.test.ts`) garde ce
   point.
2. L'application doit être servie en **HTTPS** (ou depuis `localhost`). En
   `http://` sur le LAN, les navigateurs restreignent l'accès à l'appareil ;
   l'app le détecte et l'explique au lieu d'échouer en silence, et le bouton
   « Image » reste utilisable.

Micro et géolocalisation restent explicitement refusés : l'app ne s'en sert
nulle part.

La mise en forme est **visuelle** : un mot en gras s'affiche en gras, jamais
entouré de `**`. Sous le capot, le contenu reste stocké en texte balisé et
jamais en HTML — ce qui sort du navigateur repasse toujours par notre propre
analyseur, donc aucune balise ne peut se retrouver en base. Gras, italique,
barré, listes et **cinq couleurs** sont disponibles ; les couleurs
s'éclaircissent d'elles-mêmes en thème sombre.

---

## La révision espacée

Une carte réussie ne disparaît pas : elle revient **de plus en plus tard**,
selon un système de Leitner — 1 jour, puis 3, 7, 16, 35. Une carte ratée
repart à zéro et revient dans la session courante. C'est ce qui distingue un
outil de mémorisation d'un outil de bachotage : sans ça, on marque une carte
« sue », on l'oublie, et rien ne le signale jamais.

L'accueil affiche donc un bandeau **« N cartes à réviser aujourd'hui »**, qui
mélange toutes les matières. C'est l'entrée quotidienne de l'app : un seul
nombre, un seul geste.

Deux détails d'implémentation qui se voient à l'usage :

- L'échéance est calée sur le **début de journée**. Réviser à 23 h ou à 8 h
  ramène la carte le même jour ; sinon la seconde serait annoncée « pas encore
  due » pendant quinze heures, ce qui n'a aucun sens quand on révise le soir.
- Une carte répondue **avant** la mise en place de la planification (donc sans
  échéance enregistrée) est considérée comme à réviser. Sans cette règle, toute
  carte déjà marquée « sue » lors de la mise à jour serait restée invisible
  pour toujours.

Le bouton **Réviser** d'un paquet ou d'un dossier ne propose que ce qui est
arrivé à échéance ; **Tout revoir** rejoue l'ensemble, quelle que soit la
planification.

---

## Réviser

Un paquet par cours. Chaque carte a une question au recto, une réponse au
verso, et éventuellement une image affichée à côté du texte. Les réponses
longues sont repliées dans la liste et dans la carte, avec un bouton
**Voir en entier** qui ouvre une modale lisible.

En révision :

| Geste | Clavier | Effet |
|---|---|---|
| Toucher la carte | `Espace` | Retourner la carte |
| Glisser à droite | `→` | *Je savais* — la carte sort du tas |
| Glisser à gauche | `←` | *À revoir* — la carte revient plus tard dans la session |
| — | `Z` | Annuler la dernière réponse |

Chaque réponse est enregistrée immédiatement : fermer l'onglet en cours de
session ne perd rien. Par défaut, une session ne reprend que les cartes non
acquises ; le bouton **Tout revoir** rejoue le paquet entier.

La progression est **par compte** : deux personnes révisant le même paquet
gardent des états distincts.

**Deux modes.** *Cartes* retourne la carte et te laisse juger toi-même.
*Écrire* te fait taper la réponse et la vérifie : la comparaison ignore les
accents, la casse, la ponctuation et l'article initial, tolère une faute de
frappe proportionnelle à la longueur, et accepte n'importe laquelle des
variantes séparées par « / ». Un mot voisin mais différent reste refusé —
« méiose » ne passe pas pour « mitose ». Le bouton **« En fait, je savais »**
rattrape les cas qu'aucune comparaison automatique ne peut trancher : un
synonyme, une formulation différente. Sans lui le mode deviendrait punitif.

Produire la réponse ancre nettement mieux la mémoire que la reconnaître :
s'auto-évaluer en voyant la réponse est complaisant.

**Réviser un dossier entier** — le bouton « Réviser le dossier » mélange les
cartes de tous ses paquets, sous-dossiers compris. Les cartes ne reviennent
alors plus dans l'ordre d'un paquet, ce qui empêche de reconnaître une réponse
à sa seule position dans la liste.

Quand une carte n'a pas d'image, sa réponse est agrandie et centrée : le texte
étant le seul contenu, autant qu'il se lise de loin.

---

## Importer des cartes existantes

Le bouton **Importer** d'un paquet accepte un collage de texte, au format
« terme *séparateur* définition », une carte par ligne.

**Depuis Quizlet** — utiliser la fonction d'export du jeu de cartes, qui laisse
choisir les deux séparateurs, puis coller le texte tel quel. Les valeurs par
défaut de Quizlet (tabulation entre terme et définition, retour à la ligne
entre les cartes) sont reconnues automatiquement.

**Depuis Studyield, un tableur ou un fichier texte** — coller la liste, quel
que soit le séparateur. L'app essaie tabulation, point-virgule, tiret,
deux-points puis virgule, et retient celui qui découpe proprement au moins
80 % des lignes. En dessous, elle ne devine rien plutôt que de couper au
mauvais endroit : les deux menus déroulants permettent alors de choisir à la
main, avec une option « Personnalisé » pour tout autre séparateur.

Un aperçu en direct montre les premières cartes telles qu'elles seront créées,
avant de valider. Sont gérés :

- les définitions contenant le séparateur (la coupure se fait à la **première**
  occurrence seulement) ;
- les champs CSV entre guillemets, y compris les guillemets doublés ;
- les réponses sur plusieurs lignes, en choisissant « ligne vide » comme
  séparateur de cartes ;
- les fins de ligne Windows (CRLF).

Les cartes dont le terme existe déjà dans le paquet sont ignorées par défaut
(comparaison insensible à la casse et aux espaces de bord). L'import est limité
à 1000 cartes à la fois.

**Les images ne sont pas importables** : ces exports ne contiennent que du
texte. Il faut les rattacher ensuite, carte par carte.

---

## Mettre à jour

```bash
cd ~/fiches
./scripts/update.sh
```

Le script sauvegarde la base, récupère le code, reconstruit l'image, redémarre
et attend le contrôle de santé. La construction a lieu **avant** l'arrêt du
conteneur : si elle échoue, l'application continue de tourner dans sa version
précédente.

Si la nouvelle version ne démarre pas, le script **revient tout seul** au code
et à l'image d'avant. Il ne sait en revanche pas annuler une migration de base
déjà appliquée : c'est pourquoi la sauvegarde est prise en tout premier, et
`./scripts/restore.sh` reste le chemin de retour dans ce cas.

---

## Sauvegarde et restauration

```bash
./scripts/backup.sh                                  # sauvegarde manuelle
./scripts/restore.sh fiches-2026-08-28_030000.db.gz  # restauration
```

La sauvegarde utilise `sqlite3 .backup`, l'API de copie à chaud de SQLite :
le fichier produit est cohérent même si l'app écrit pendant l'opération.
Copier le `.db` avec `cp` ou `rsync`, à l'inverse, peut capturer une base à
moitié écrite. Les 30 dernières copies sont conservées sur le NAS
(`FICHES_BACKUP_KEEP` pour changer ce nombre).

Le timer systemd `fiches-backup.timer` déclenche la sauvegarde chaque nuit à
3 h, avec rattrapage si la machine était éteinte.

```bash
systemctl list-timers fiches-backup.timer   # prochaine exécution
journalctl -u fiches-backup.service         # journal des sauvegardes
```

**Ce qu'il faut sauvegarder :** le dossier `backups/` du NAS (la base) et le
dossier `uploads/` du NAS (les images). Les deux ensemble suffisent à tout
reconstruire.

---

## Développement

### En local, sans Docker

```bash
cp .env.example .env        # puis renseigner SESSION_SECRET
npm install
npx prisma migrate deploy   # crée data/dev.db
npm run user:create -- --email toi@exemple.com --name Toi --admin
npm run dev                 # http://localhost:3000
```

### Ouvrir le serveur de dev depuis un autre appareil

Next 16 bloque par défaut (403) les requêtes vers les assets du serveur de
développement venant d'une origine autre que `localhost`. Ouvrir
`http://192.168.x.y:3000` depuis un téléphone donne alors une page nue, des
403 sur `/_next/static/...` en console, et un WebSocket de rechargement à
chaud qui échoue en boucle.

[next.config.ts](next.config.ts) autorise déjà le LAN en `192.168.x.y` et les
noms MagicDNS de Tailscale en `.ts.net`. Pour tout autre cas — plage privée
en `10.x.y.z`, nom mDNS, adresse Tailscale en `100.x.y.z` — ajouter les
origines dans `.env` :

```bash
ALLOWED_DEV_ORIGINS="10.0.0.12,mon-pc.local"
```

Cette protection ne concerne **que** `next dev`. En production, c'est le
reverse proxy qui décide de ce qui entre, et cette configuration n'a aucun
effet.

### Dans Docker, avec rechargement à chaud

```bash
docker compose -f docker-compose.dev.yml up --build
# http://localhost:3001
```

Le code est bind-monté, la base et les images vivent dans le volume `dev_data`,
séparé de la production. Pour repartir de zéro :
`docker compose -f docker-compose.dev.yml down -v`.

### Tests

```bash
npm test           # une passe
npm run test:watch # relance à chaque modification
```

111 tests, environ une seconde, **sans navigateur ni base de données**. Ils
utilisent le lanceur intégré de Node (`node --test`) : aucune dépendance de
test à part `jsdom`, nécessaire pour éprouver le sérialiseur de l'éditeur.

Ce qui est couvert :

| Fichier | Ce qu'il protège |
|---|---|
| `scheduling.test.ts` | paliers de Leitner, calage sur le début de journée, libellés d'échéance |
| `answer-check.test.ts` | tolérance aux accents et aux fautes de frappe — **et les refus** |
| `import.test.ts` | formats Quizlet, CSV, détection automatique, refus de deviner |
| `rich-text.test.ts` | analyse du balisage, rendu React, échappement du HTML |
| `rich-editor.test.ts` | traduction DOM → balisage, et l'aller-retour complet |
| `crop.test.ts` | géométrie du recadrage : bornes, inversion, réduction |
| `headers.test.ts` | politique d'autorisations et en-têtes de sécurité |
| `folder-tree.test.ts` | fil d'Ariane, cycles, sous-arbres |
| `upload-path.test.ts` | liste blanche des noms de fichiers, traversée de chemin |

La logique pure vit dans des modules sans `server-only` (`folder-tree.ts`,
`upload-path.ts`, `scheduling.ts`, `answer-check.ts`, `import.ts`) précisément
pour être testable sans base ni serveur. Les parcours qui exigent un navigateur
— glisser-déposer, mise en forme visuelle, révision — ne sont pas couverts ici.

### Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | serveur de développement |
| `npm run build` | build de production (vérifie aussi les types) |
| `npm run typecheck` | TypeScript seul |
| `npm run lint` | ESLint |
| `npm test` | tests unitaires |
| `npm run db:migrate` | crée une migration après modification du schéma |
| `npm run db:deploy` | applique les migrations existantes |
| `npm run db:studio` | explorateur de base Prisma |
| `npm run user:create` | crée un compte / réinitialise un mot de passe |
| `npm run icons` | régénère les icônes de la PWA |

Côté serveur : `./scripts/update.sh` met à jour, `./scripts/backup.sh` sauvegarde.

### Modifier le schéma

Le projet utilise des **migrations versionnées**, pas `db push` : `db push`
peut supprimer une colonne pour réconcilier le schéma, et emporter les données
avec elle.

```bash
# après avoir édité prisma/schema.prisma
npm run db:migrate -- --name description_du_changement
git add prisma/migrations
```

Au démarrage du conteneur, l'entrypoint applique `prisma migrate deploy`, qui
n'applique que des migrations existantes et ne supprime jamais de colonne.

---

## Structure

```
prisma/schema.prisma          modèles : User, Deck, Card, CardProgress, StudySession
src/proxy.ts                  aiguillage des routes selon le cookie (ex-middleware)
src/lib/
  auth.ts                     couche d'accès : getCurrentUser, requireUser, requireAdmin
  session.ts                  jeton JWT signé, posé en cookie httpOnly
  uploads.ts                  écriture et résolution des images, liste blanche stricte
  decks.ts                    lectures des paquets et des cartes
src/app/
  (auth)/login/               connexion
  (app)/                      tout ce qui exige une session
    decks/[deckId]/           éditeur de cartes
    decks/[deckId]/study/     mode révision
    admin/                    gestion des comptes
  api/uploads/[file]/         service des images, protégé par session
scripts/
  install.sh                  installation clé en main
  backup.sh / restore.sh      sauvegarde et restauration
  create-user.ts              gestion des comptes en ligne de commande
  generate-icons.mjs          génère les PNG de la PWA
```

### Choix de sécurité

- Le `proxy.ts` ne fait qu'un aiguillage sur la **présence** du cookie. Toute
  autorisation réelle passe par `requireUser()` / `requireAdmin()` dans les
  pages et les actions serveur : une faille du proxy ne suffit donc pas à
  accéder aux données.
- Chaque écriture filtre sur `ownerId` dans la clause `where`, plutôt que de
  vérifier puis écrire. Un paquet qui n'est pas le tien donne zéro ligne
  touchée, pas une modification chez quelqu'un d'autre.
- Un paquet inexistant et le paquet de quelqu'un d'autre renvoient tous deux
  **404**, ce qui empêche de deviner ce qui existe.
- Les noms de fichiers images sont générés côté serveur (UUID + extension de
  la liste blanche) et validés par expression régulière stricte à la lecture.
  Le nom envoyé par le client n'atteint jamais le disque.
- Les mots de passe sont hachés avec bcrypt, coût 12.
