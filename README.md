# Fiches

Cartes de révision auto-hébergées : un paquet par cours, des cartes
question / réponse avec image, et un mode révision en deux piles — *je savais*
d'un côté, *à revoir* de l'autre. Installable comme une application sur
téléphone (PWA). Multi-comptes, sans inscription publique, sans IA.

**Pile technique** — Next.js 16 (App Router, Turbopack), React 19, Prisma +
SQLite, Tailwind CSS v4, Radix UI, Motion.

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

### Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | serveur de développement |
| `npm run build` | build de production (vérifie aussi les types) |
| `npm run typecheck` | TypeScript seul |
| `npm run lint` | ESLint |
| `npm run db:migrate` | crée une migration après modification du schéma |
| `npm run db:deploy` | applique les migrations existantes |
| `npm run db:studio` | explorateur de base Prisma |
| `npm run user:create` | crée un compte / réinitialise un mot de passe |
| `npm run icons` | régénère les icônes de la PWA |

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
