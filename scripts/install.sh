#!/usr/bin/env bash
# Installation clé en main de Fiches sur Xubuntu (ou toute Debian/Ubuntu).
#
#   ./scripts/install.sh
#
# Le script est idempotent : on peut le relancer sans rien casser. Il ne
# supprime jamais de données et demande confirmation avant chaque étape
# qui touche au système.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

BOLD=$(tput bold 2>/dev/null || true)
DIM=$(tput dim 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

step() { echo; echo "${BOLD}▸ $1${RESET}"; }
info() { echo "  ${DIM}$1${RESET}"; }
fail() { echo "  ❌ $1" >&2; exit 1; }

ask() {
  # ask <question> <valeur-par-défaut> -> écrit la réponse sur stdout
  local question="$1" default="$2" answer
  read -rp "  ${question} [${default}] " answer </dev/tty
  echo "${answer:-$default}"
}

confirm() {
  local answer
  read -rp "  $1 [o/N] " answer </dev/tty
  [ "$answer" = "o" ] || [ "$answer" = "O" ] || [ "$answer" = "oui" ]
}

# ---------------------------------------------------------------------------
step "Vérification du système"
# ---------------------------------------------------------------------------

[ "$(id -u)" -ne 0 ] || fail "Ne lance pas ce script en root : Docker doit tourner sous ton compte."
command -v apt-get >/dev/null || fail "Ce script vise Debian/Ubuntu (Xubuntu inclus)."
info "$(. /etc/os-release && echo "$PRETTY_NAME")"

# ---------------------------------------------------------------------------
step "Docker"
# ---------------------------------------------------------------------------

if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  info "déjà installé : $(docker --version)"
else
  echo "  Docker et le plugin compose sont absents."
  confirm "Les installer depuis le dépôt officiel Docker ?" || fail "Installation interrompue."

  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  # Sans ça, chaque commande docker exigerait sudo.
  sudo usermod -aG docker "$USER"
  info "Ton compte a été ajouté au groupe docker."
  info "Ferme puis rouvre ta session (ou lance « newgrp docker ») avant de continuer."
fi

# ---------------------------------------------------------------------------
step "Emplacement des données sur le NAS"
# ---------------------------------------------------------------------------

echo "  Les images des cartes et les sauvegardes de la base vont sur le NAS."
echo "  La base SQLite, elle, reste sur le disque local : SQLite se corrompt"
echo "  sur un partage réseau, le verrouillage de fichiers n'y étant pas fiable."
echo

NAS_ROOT=$(ask "Racine du montage NAS pour Fiches :" "/mnt/nas/fiches")
NAS_UPLOADS="${NAS_ROOT}/uploads"
NAS_BACKUPS="${NAS_ROOT}/backups"

if ! mountpoint -q "$(dirname "$NAS_ROOT")" 2>/dev/null && ! mountpoint -q "$NAS_ROOT" 2>/dev/null; then
  echo
  echo "  ⚠️  ${NAS_ROOT} ne semble pas être (ou contenir) un point de montage."
  echo "     Si le partage n'est pas monté, les images seront écrites sur le"
  echo "     disque local sans que rien ne le signale."
  confirm "Continuer quand même ?" || fail "Monte d'abord le partage, puis relance."
fi

mkdir -p "$NAS_UPLOADS" "$NAS_BACKUPS"
[ -w "$NAS_UPLOADS" ] || fail "${NAS_UPLOADS} n'est pas accessible en écriture."
[ -w "$NAS_BACKUPS" ] || fail "${NAS_BACKUPS} n'est pas accessible en écriture."
info "uploads   → ${NAS_UPLOADS}"
info "backups   → ${NAS_BACKUPS}"

# ---------------------------------------------------------------------------
step "Configuration (.env)"
# ---------------------------------------------------------------------------

if [ -f .env ] && grep -q "^SESSION_SECRET=" .env; then
  info ".env existe déjà, il est conservé tel quel."
  info "Supprime-le et relance le script pour repartir de zéro."
else
  APP_PORT=$(ask "Port local du conteneur :" "3002")
  HOSTNAME_=$(ask "Nom d'hôte servi par le reverse proxy :" "fiches.local")

  # 32 octets aléatoires : c'est la clé qui signe les cookies de session.
  # La régénérer déconnecte tout le monde, sans autre conséquence.
  SECRET=$(openssl rand -base64 32)

  cat > .env <<ENVEOF
# Généré par scripts/install.sh le $(date +%Y-%m-%d).
# Ce fichier contient un secret : il n'est pas versionné (voir .gitignore).

APP_PORT=${APP_PORT}
SESSION_SECRET=${SECRET}
NAS_UPLOADS=${NAS_UPLOADS}
NAS_BACKUPS=${NAS_BACKUPS}
FICHES_HOSTNAME=${HOSTNAME_}
COOKIE_SECURE=true
ENVEOF
  chmod 600 .env
  info ".env créé, avec un SESSION_SECRET aléatoire."
fi

# ---------------------------------------------------------------------------
step "Construction et démarrage"
# ---------------------------------------------------------------------------

docker compose up -d --build

info "Attente du démarrage…"
for _ in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' fiches 2>/dev/null)" = "healthy" ]; then
    break
  fi
  sleep 2
done

if [ "$(docker inspect -f '{{.State.Health.Status}}' fiches 2>/dev/null)" != "healthy" ]; then
  echo
  echo "  ❌ Le conteneur n'est pas passé en bonne santé. Journal :"
  docker compose logs --tail 40 app
  exit 1
fi
info "Conteneur en bonne santé."

# ---------------------------------------------------------------------------
step "Premier compte administrateur"
# ---------------------------------------------------------------------------

# La page /admin exige déjà d'être admin : le tout premier compte ne peut être
# créé qu'ici.
EXISTING=$(docker compose exec -T app sh -c \
  "sqlite3 /app/data/app.db 'SELECT COUNT(*) FROM User;' 2>/dev/null || echo 0")

if [ "${EXISTING:-0}" -gt 0 ]; then
  info "${EXISTING} compte(s) déjà en base, rien à créer."
else
  ADMIN_EMAIL=$(ask "Courriel de l'administrateur :" "admin@fiches.local")
  ADMIN_NAME=$(ask "Nom affiché :" "Admin")

  # Le mot de passe transite par une variable d'environnement du conteneur,
  # jamais par argv : argv est lisible par tous les processus de la machine.
  read -rsp "  Mot de passe (8 caractères minimum) : " ADMIN_PASSWORD </dev/tty
  echo
  read -rsp "  Confirme le mot de passe : " ADMIN_CONFIRM </dev/tty
  echo
  [ "$ADMIN_PASSWORD" = "$ADMIN_CONFIRM" ] || fail "Les deux saisies diffèrent."
  [ ${#ADMIN_PASSWORD} -ge 8 ] || fail "Mot de passe trop court."

  docker compose exec -T -e FICHES_PASSWORD="$ADMIN_PASSWORD" app \
    npx tsx scripts/create-user.ts --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" --admin \
    || fail "Création du compte échouée."
  unset ADMIN_PASSWORD ADMIN_CONFIRM
fi

# ---------------------------------------------------------------------------
step "Sauvegarde automatique de la base vers le NAS"
# ---------------------------------------------------------------------------

if confirm "Installer un timer systemd qui sauvegarde la base chaque nuit ?"; then
  sudo tee /etc/systemd/system/fiches-backup.service > /dev/null <<UNITEOF
[Unit]
Description=Sauvegarde de la base Fiches vers le NAS
# Inutile de tenter la sauvegarde avant que Docker soit là.
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=${USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${PROJECT_DIR}/scripts/backup.sh
UNITEOF

  sudo tee /etc/systemd/system/fiches-backup.timer > /dev/null <<UNITEOF
[Unit]
Description=Sauvegarde nocturne de Fiches

[Timer]
OnCalendar=*-*-* 03:00:00
# Rattrape la sauvegarde si la machine était éteinte à 3 h du matin.
Persistent=true

[Install]
WantedBy=timers.target
UNITEOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now fiches-backup.timer
  info "Timer actif. Prochaine exécution :"
  systemctl list-timers fiches-backup.timer --no-pager | sed -n '2p' | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
step "Terminé"
# ---------------------------------------------------------------------------

APP_PORT=$(grep '^APP_PORT=' .env | cut -d= -f2)
echo
echo "  Fiches tourne sur ${BOLD}http://127.0.0.1:${APP_PORT}${RESET}"
echo
echo "  Le conteneur n'écoute que sur la boucle locale. Pour y accéder depuis"
echo "  ton téléphone et installer la PWA, il faut du HTTPS : voir la section"
echo "  « Accès depuis le réseau » du README."
echo
echo "  Commandes utiles :"
echo "    docker compose logs -f app     journal de l'app"
echo "    docker compose restart app     redémarrage"
echo "    ./scripts/backup.sh            sauvegarde manuelle"
echo "    ./scripts/restore.sh <fichier> restauration"
echo
