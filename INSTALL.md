# Installation de Fiches sur Linux — procédure pas à pas

Ce document est un **runbook exécutable**. Il est écrit pour être suivi
littéralement, par une personne ou par un agent IA, sans connaissance
préalable du projet.

## Règles pour qui exécute cette procédure

1. **Exécuter les étapes dans l'ordre.** Chaque étape suppose la précédente réussie.
2. **Après chaque commande, comparer la sortie à la section « Vérifier ».**
   Si elle ne correspond pas, aller à [Diagnostic](#diagnostic) plutôt que
   de poursuivre.
3. **Ne jamais exécuter ces commandes avec `sudo`**, sauf là où c'est écrit
   explicitement. Docker doit tourner sous le compte utilisateur.
4. **Ne jamais committer le fichier `.env`.** Il contient la clé de signature
   des sessions. Il est déjà dans `.gitignore` ; ne pas l'en retirer.
5. **Ne rien inventer.** Si une information manque (chemin du NAS, nom
   d'hôte), la demander à l'utilisateur au lieu de choisir une valeur.

## Informations à réunir avant de commencer

| Variable | Description | Exemple |
|---|---|---|
| `REPO_URL` | URL du dépôt Git contenant le projet | `git@github.com:moi/fiches.git` |
| `NAS_ROOT` | Dossier du NAS **déjà monté** sur le Linux, dédié à Fiches | `/mnt/nas/fiches` |
| `APP_PORT` | Port local, non exposé au réseau | `3002` |
| `ADMIN_EMAIL` | Courriel du premier compte administrateur | `moi@exemple.com` |
| `ADMIN_NAME` | Nom affiché de ce compte | `Cathou` |
| `TAILSCALE_HOST` | Nom MagicDNS de la machine, si accès à distance souhaité | `xubuntu.tail1234.ts.net` |

Demander ces valeurs à l'utilisateur si elles ne sont pas déjà connues.

---

# Partie A — Publier le code depuis la machine de développement

À faire **une seule fois**, sur la machine où le projet a été développé.

## A.1 — Vérifier que rien de sensible ne partira dans le dépôt

```bash
cd /Users/cathou/fiches
git status --porcelain --ignored | grep -E '^!! (\.env$|data/)'
```

**Vérifier :** la sortie doit contenir `!! .env` et `!! data/`. Ces deux
entrées confirment qu'ils sont ignorés. Si `.env` n'apparaît pas comme ignoré,
**s'arrêter** : le secret de session partirait dans le dépôt.

## A.2 — Vérifier que les migrations partiront bien, elles

```bash
ls prisma/migrations/*/migration.sql
```

**Vérifier :** au moins un fichier est listé. Sans les migrations, la base ne
pourra pas être créée sur le serveur.

## A.3 — Publier

```bash
git add -A
git commit -m "Application de cartes de révision"
git remote add origin <REPO_URL>   # à ignorer si le distant existe déjà
git push -u origin main
```

**Vérifier :** `git status` indique `nothing to commit, working tree clean`.

> **Note :** un dépôt privé est recommandé. Le code ne contient aucun secret,
> mais il décrit l'architecture de ton installation.

---

# Partie B — Installer sur le Linux

Toutes les commandes de cette partie s'exécutent **sur la machine Linux**.

## B.1 — Vérifier que le partage NAS est monté

```bash
mountpoint -q <NAS_ROOT> && echo "monté" || echo "NON MONTÉ"
```

**Vérifier :** la sortie est `monté`. Si le chemin exact n'est pas un point de
montage mais se trouve *dans* un montage, vérifier le parent :

```bash
df -h <NAS_ROOT>
```

La colonne `Filesystem` doit désigner le NAS (une adresse `//serveur/partage`
ou `serveur:/export`), et non le disque local.

**Si le NAS n'est pas monté : s'arrêter ici.** Le monter d'abord, sinon les
images seront écrites sur le disque local sans qu'aucun message ne le signale.

## B.2 — Vérifier que le partage est accessible en écriture

```bash
mkdir -p <NAS_ROOT>/uploads <NAS_ROOT>/backups
touch <NAS_ROOT>/uploads/.test && rm <NAS_ROOT>/uploads/.test && echo "écriture OK"
```

**Vérifier :** la sortie est `écriture OK`.
Si `Permission denied`, voir [Diagnostic → écriture NAS refusée](#écriture-sur-le-nas-refusée).

## B.3 — Vérifier qu'aucun service n'occupe déjà le port

D'autres conteneurs tournent peut-être déjà sur cette machine.

```bash
ss -tlnp | grep ":<APP_PORT>" || echo "port libre"
```

**Vérifier :** la sortie est `port libre`. Sinon, choisir un autre `APP_PORT`
et utiliser cette nouvelle valeur pour toute la suite.

## B.4 — Récupérer le code

```bash
cd ~
git clone <REPO_URL> fiches
cd fiches
```

**Vérifier :**

```bash
ls scripts/install.sh docker-compose.yml Dockerfile && echo "dépôt complet"
```

La sortie se termine par `dépôt complet`.

## B.5 — Lancer l'installation

```bash
./scripts/install.sh
```

Le script est **idempotent** : en cas d'échec, on le corrige puis on le
relance sans rien casser.

Il pose des questions dans cet ordre :

| Question | Réponse |
|---|---|
| Installer Docker ? | `o` si Docker est absent |
| Racine du montage NAS | `<NAS_ROOT>` |
| Port local du conteneur | `<APP_PORT>` |
| Nom d'hôte du reverse proxy | `<TAILSCALE_HOST>`, ou `fiches.local` pour du LAN seul |
| Courriel de l'administrateur | `<ADMIN_EMAIL>` |
| Nom affiché | `<ADMIN_NAME>` |
| Mot de passe | 8 caractères minimum, saisi deux fois, non affiché |
| Installer le timer de sauvegarde ? | `o` |

Ce que le script fait, dans l'ordre : installe Docker si besoin → vérifie le
montage NAS → génère `.env` avec un `SESSION_SECRET` aléatoire → construit
l'image → démarre le conteneur → attend qu'il soit en bonne santé → crée le
premier compte administrateur → installe le timer systemd de sauvegarde.

> **Si Docker vient d'être installé** par le script, le compte a été ajouté au
> groupe `docker`, ce qui ne prend effet qu'à la prochaine session. Fermer et
> rouvrir la session (ou lancer `newgrp docker`), puis **relancer le script**.

**Vérifier :** le script se termine par « Fiches tourne sur
http://127.0.0.1:`<APP_PORT>` ».

## B.6 — Vérifier l'installation

```bash
# 1. Le conteneur tourne et se déclare en bonne santé
docker compose ps

# 2. La base répond
curl -s http://127.0.0.1:<APP_PORT>/api/health

# 3. Une page protégée redirige vers la connexion
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<APP_PORT>/

# 4. La page de connexion s'affiche
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<APP_PORT>/login

# 5. Le compte administrateur existe
docker compose exec -T app sqlite3 /app/data/app.db \
  "SELECT email, role FROM User;"
```

**Vérifier :**

| # | Sortie attendue |
|---|---|
| 1 | une ligne `fiches`, `STATUS` contenant `healthy` |
| 2 | `{"ok":true}` |
| 3 | `307` — la redirection vers `/login` prouve que la protection est active |
| 4 | `200` |
| 5 | `<ADMIN_EMAIL>|admin` |

Si le point 3 renvoie `200`, **s'arrêter** : l'application n'est pas protégée.

---

# Partie C — Accès depuis le téléphone et les autres appareils

Le conteneur n'écoute que sur `127.0.0.1`. C'est délibéré : le cookie de
session est marqué `Secure` et les service workers exigent HTTPS. Sans
reverse proxy, l'application n'est ni installable en PWA ni protégée en
transit.

Tailscale est déjà en place sur cette machine : c'est la voie à suivre.

## C.1 — Obtenir un certificat Tailscale

```bash
tailscale status | head -1          # confirme que Tailscale est connecté
sudo tailscale cert <TAILSCALE_HOST>
```

**Vérifier :** deux fichiers sont écrits, `<TAILSCALE_HOST>.crt` et
`<TAILSCALE_HOST>.key`.

Si la commande échoue avec `HTTPS is not enabled`, activer HTTPS pour le
tailnet dans la console d'administration Tailscale
(**DNS → HTTPS Certificates**), puis relancer.

## C.2 — Installer Caddy

```bash
sudo apt-get install -y caddy
```

## C.3 — Configurer Caddy

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
<TAILSCALE_HOST> {
    reverse_proxy 127.0.0.1:<APP_PORT>

    # Les images des cartes peuvent atteindre 8 Mo ; sans cette limite
    # relevée, Caddy tronque les envois volumineux.
    request_body {
        max_size 12MB
    }
}
EOF

sudo systemctl reload caddy
```

**Vérifier :**

```bash
systemctl is-active caddy                       # -> active
curl -sI https://<TAILSCALE_HOST>/login | head -1   # -> HTTP/2 200
```

Caddy demande son propre certificat via Tailscale. Le premier appel peut
prendre quelques secondes.

## C.4 — Installer la PWA sur le téléphone

1. Connecter le téléphone au même tailnet (application Tailscale).
2. Ouvrir `https://<TAILSCALE_HOST>` dans le navigateur.
3. Se connecter avec `<ADMIN_EMAIL>`.
4. **iOS (Safari) :** bouton Partager → « Sur l'écran d'accueil ».
   **Android (Chrome) :** menu ⋮ → « Installer l'application ».

**Vérifier :** l'application se lance depuis l'écran d'accueil, sans barre
d'adresse.

> Si l'option d'installation n'apparaît pas, c'est presque toujours que la
> page n'est pas servie en HTTPS valide. Revérifier C.3.

---

# Vérification finale

Cocher chaque point avant de considérer l'installation terminée.

- [ ] `docker compose ps` montre `fiches` en `healthy`
- [ ] `curl http://127.0.0.1:<APP_PORT>/api/health` renvoie `{"ok":true}`
- [ ] La connexion fonctionne avec le compte administrateur
- [ ] Créer un paquet, y ajouter une carte **avec une image** : l'image
      s'affiche, et un clic dessus l'ouvre en plein écran
- [ ] Une réponse longue affiche le bouton « Voir la réponse en entier »
- [ ] Le mode révision répond aux flèches `←` `→` et au glissement
- [ ] Le fichier image est bien apparu sur le NAS :
      `ls <NAS_ROOT>/uploads/`
- [ ] `./scripts/backup.sh` produit un fichier dans `<NAS_ROOT>/backups/`
- [ ] `systemctl list-timers fiches-backup.timer` montre une prochaine exécution

---

# Diagnostic

## Le conteneur ne démarre pas

```bash
docker compose logs --tail 50 app
```

| Message dans le journal | Cause | Correction |
|---|---|---|
| `SESSION_SECRET absent ou trop court` | `.env` absent ou incomplet | `openssl rand -base64 32`, mettre la valeur dans `.env`, `docker compose up -d` |
| `UPLOAD_DIR (…) n'existe pas` | Le partage NAS n'est pas monté sur l'hôte | Monter le partage, puis `docker compose restart app` |
| `Error: P1003` ou `database does not exist` | Migrations non appliquées | `docker compose exec app npx prisma migrate deploy` |
| `bind: address already in use` | Le port est pris par un autre conteneur | Changer `APP_PORT` dans `.env`, puis `docker compose up -d` |

## `npm ci` échoue sur une dépendance manquante (`@emnapi`)

Symptôme, pendant `docker compose build` :

```
npm error `npm ci` can only install packages when your package.json and
package-lock.json are in sync … Missing: @emnapi/runtime@… from lock file
```

**Cause.** Ce n'est pas un lock corrompu, mais une divergence entre versions de
npm. npm 11 omet du lock les dépendances des paquets optionnels incompatibles
avec la plateforme courante (ici les variantes `wasm32` de `sharp` et de
Tailwind). npm 10 — celui qu'embarque `node:22-bookworm-slim` — les exige.
Un lock généré sous npm 11 casse donc le build en conteneur.

**Correction.** Régénérer le lock avec npm 10, qui produit un sur-ensemble
accepté par les deux versions :

```bash
npx --yes npm@10 install --package-lock-only
```

L'opération est purement additive : elle ajoute les entrées manquantes sans
changer aucune version. Vérifier, puis committer :

```bash
grep -c '"node_modules/@emnapi/runtime"' package-lock.json   # doit renvoyer 1
git add package-lock.json && git commit -m "Complète le lock pour npm 10"
```

**Pour éviter la rechute.** Tout `npm install` lancé avec npm 11 réécrira le
lock dans le format court et ramènera le problème. Après une mise à jour de
dépendances, refaire passer la commande ci-dessus avant de committer.

## `Unknown argument` sur un champ récent (client Prisma périmé)

Symptôme, dans le navigateur ou les logs :

```
PrismaClientValidationError … Unknown argument `dueAt`
```

**Cause.** Le client Prisma est du code *généré* à partir du schéma. Après un
`git pull` qui apporte un nouveau champ, il faut le régénérer — sinon il
continue de décrire l'ancien schéma.

**Correction.** Le projet a désormais un hook `postinstall` qui s'en charge,
mais si le client est déjà périmé :

```bash
npx prisma generate        # régénère le client
npm run db:deploy          # applique les migrations manquantes à la base
```

Dans Docker, les deux sont faits automatiquement (au build pour la génération,
par l'entrypoint pour les migrations) : ce cas ne concerne que le
développement local.

## Écriture sur le NAS refusée

Le conteneur écrit en tant que `root`. Selon le type de partage :

**NFS avec `root_squash`** — `root` est ramené à `nobody` et perd le droit
d'écriture. Deux options : exporter le partage avec `no_root_squash` côté NAS,
ou remonter en spécifiant un utilisateur.

**SMB / CIFS** — préciser le propriétaire au montage. Dans `/etc/fstab` :

```
//nas/fiches  /mnt/nas/fiches  cifs  credentials=/etc/samba/creds,uid=1000,gid=1000,file_mode=0664,dir_mode=0775  0  0
```

Puis `sudo mount -a` et vérifier avec l'étape [B.2](#b2--vérifier-que-le-partage-est-accessible-en-écriture).

## La page se charge sans style, erreurs 403 en console

Symptôme : `Failed to load resource: 403` sur `/_next/static/chunks/…`.

Cela ne concerne **que le serveur de développement** (`npm run dev`), jamais
la production. Next refuse les origines autres que `localhost`. Ajouter
l'origine utilisée dans `.env` :

```bash
ALLOWED_DEV_ORIGINS="10.0.0.12,mon-pc.local"
```

Les adresses `192.168.x.y` et les noms `*.ts.net` sont déjà autorisés.

## Impossible de se connecter : le formulaire revient vide

Le cookie de session est marqué `Secure` et n'est donc pas conservé sur une
connexion `http://`. Soit servir l'application en HTTPS (Partie C), soit —
pour du dépannage local uniquement — mettre `COOKIE_SECURE=false` dans `.env`
puis `docker compose up -d`.

## Mot de passe administrateur perdu

```bash
docker compose exec -it app npx tsx scripts/create-user.ts \
  --email <ADMIN_EMAIL> --name <ADMIN_NAME> --admin
```

La commande réinitialise le mot de passe d'un compte existant.

---

# Exploitation courante

| Besoin | Commande |
|---|---|
| Voir le journal | `docker compose logs -f app` |
| Redémarrer | `docker compose restart app` |
| Arrêter | `docker compose down` |
| Sauvegarder maintenant | `./scripts/backup.sh` |
| Restaurer | `./scripts/restore.sh fiches-AAAA-MM-JJ_HHMMSS.db.gz` |
| Mettre à jour | `./scripts/update.sh` |
| Lister les sauvegardes | `ls -lt <NAS_ROOT>/backups/` |
| Créer un compte | depuis la page **Comptes** de l'application (icône bouclier) |

## Déployer une mise à jour du code

```bash
cd ~/fiches
./scripts/update.sh
```

Le script enchaîne : contrôle qu'aucune modification locale ne sera écrasée →
sauvegarde de la base → `git merge --ff-only` → reconstruction → redémarrage →
contrôle de santé. La construction a lieu **avant** l'arrêt du conteneur :
si elle échoue, l'application continue de tourner dans sa version précédente.

Si la nouvelle version ne passe pas le contrôle de santé, le script remet le
code et l'image d'avant, puis redémarre. Il ne sait pas annuler une migration
de base déjà appliquée : dans ce cas, restaurer la sauvegarde prise au début
avec `./scripts/restore.sh <fichier>`.

**Vérifier :** le script se termine par « Fiches est à jour ».

---

# Ce qui n'a pas été testé

La partie Docker de ce projet (image, `docker-compose.yml`,
`scripts/install.sh`) **n'a pas pu être exécutée** au moment de l'écriture :
Docker n'était pas disponible sur la machine de développement. L'application
elle-même a été vérifiée en conditions de production hors conteneur
(authentification, autorisations, envoi et service des images, rendu des
pages).

C'est donc à la Partie B que des ajustements sont les plus probables. Les
sections [Diagnostic](#diagnostic) couvrent les défaillances attendues.
