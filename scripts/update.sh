#!/usr/bin/env bash
# Mise à jour de Fiches depuis le dépôt Git.
#
#   ./scripts/update.sh
#
# Déroulé : sauvegarde de la base → récupération du code → reconstruction de
# l'image → redémarrage → contrôle de santé. En cas d'échec au démarrage, le
# script revient automatiquement à la version précédente.
#
# Ce qu'il ne sait PAS annuler : une migration de base déjà appliquée. C'est la
# raison de la sauvegarde faite en tout premier ; la restaurer est le chemin de
# retour si une migration se révèle destructrice.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

BOLD=$(tput bold 2>/dev/null || true)
DIM=$(tput dim 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

step() { echo; echo "${BOLD}▸ $1${RESET}"; }
info() { echo "  ${DIM}$1${RESET}"; }
fail() { echo "  ❌ $1" >&2; exit 1; }

ROLLBACK_TAG="fiches:rollback"

# ---------------------------------------------------------------------------
step "Contrôles préalables"
# ---------------------------------------------------------------------------

command -v docker >/dev/null || fail "Docker est introuvable. Lance d'abord ./scripts/install.sh"
[ -f .env ] || fail ".env manquant. Lance d'abord ./scripts/install.sh"

# Une modification locale non validée serait écrasée par le git pull, ou le
# ferait échouer à mi-chemin.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "  Des modifications locales non validées sont présentes :"
  git status --short | sed 's/^/    /'
  fail "Valide-les ou annule-les (git checkout .) avant de mettre à jour."
fi

BEFORE="$(git rev-parse HEAD)"
info "version actuelle : $(git log -1 --format='%h %s' | cut -c1-70)"

# ---------------------------------------------------------------------------
step "Récupération du code"
# ---------------------------------------------------------------------------

git fetch --quiet
# --ff-only : on refuse de fusionner. Si l'historique a divergé, mieux vaut le
# régler à la main que de créer un commit de fusion sur le serveur.
if ! git merge --ff-only @{u} 2>/dev/null; then
  fail "Impossible d'avancer sans fusion. Règle l'historique à la main (git status)."
fi

AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo
  echo "  ${BOLD}Déjà à jour.${RESET} Rien à faire."
  exit 0
fi

info "nouvelle version : $(git log -1 --format='%h %s' | cut -c1-70)"
echo "  Changements :"
git log --oneline "$BEFORE..$AFTER" | head -10 | sed 's/^/    /'

# ---------------------------------------------------------------------------
step "Sauvegarde de la base avant migration"
# ---------------------------------------------------------------------------

if docker compose ps --status running --quiet app >/dev/null 2>&1 \
   && [ -n "$(docker compose ps --status running --quiet app)" ]; then
  ./scripts/backup.sh
else
  info "conteneur arrêté : rien à sauvegarder."
fi

# ---------------------------------------------------------------------------
step "Conservation de l'image actuelle pour un retour arrière"
# ---------------------------------------------------------------------------

if docker image inspect fiches:latest >/dev/null 2>&1; then
  docker tag fiches:latest "$ROLLBACK_TAG"
  info "image précédente conservée sous $ROLLBACK_TAG"
else
  info "aucune image précédente : pas de retour arrière possible."
fi

# ---------------------------------------------------------------------------
step "Reconstruction"
# ---------------------------------------------------------------------------

# Le build peut échouer sans avoir touché au conteneur qui tourne : on le fait
# avant l'arrêt, pour que l'app reste disponible pendant ce temps.
if ! docker compose build; then
  echo
  echo "  ❌ La construction a échoué. L'application n'a pas été touchée et"
  echo "     tourne toujours dans sa version précédente."
  echo "     Pour revenir au code d'avant : git reset --hard $BEFORE"
  exit 1
fi

# ---------------------------------------------------------------------------
step "Redémarrage"
# ---------------------------------------------------------------------------

docker compose up -d

info "attente du contrôle de santé…"
HEALTHY=""
for _ in $(seq 1 60); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' fiches 2>/dev/null || echo starting)"
  if [ "$STATUS" = "healthy" ]; then HEALTHY="oui"; break; fi
  if [ "$STATUS" = "unhealthy" ]; then break; fi
  sleep 2
done

if [ -z "$HEALTHY" ]; then
  echo
  echo "  ❌ La nouvelle version ne démarre pas. Journal :"
  docker compose logs --tail 40 app | sed 's/^/    /'

  step "Retour à la version précédente"
  git reset --hard "$BEFORE" --quiet
  if docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1; then
    docker tag "$ROLLBACK_TAG" fiches:latest
    docker compose up -d
    info "version précédente redémarrée."
  else
    fail "Aucune image de secours. Reconstruis à la main : docker compose up -d --build"
  fi

  echo
  echo "  Le code est revenu à $BEFORE et l'ancienne version tourne."
  echo "  Si une migration de base a été appliquée avant l'échec, restaure la"
  echo "  sauvegarde prise au début : ./scripts/restore.sh <fichier>"
  exit 1
fi

# ---------------------------------------------------------------------------
step "Terminé"
# ---------------------------------------------------------------------------

APP_PORT="$(grep '^APP_PORT=' .env | cut -d= -f2 || echo 3002)"
echo
echo "  ${BOLD}Fiches est à jour${RESET} et répond sur http://127.0.0.1:${APP_PORT}"
info "version : $(git log -1 --format='%h %s' | cut -c1-70)"
echo
info "L'image précédente reste disponible sous $ROLLBACK_TAG."
info "Pour l'effacer une fois la mise à jour éprouvée : docker image rm $ROLLBACK_TAG"
echo
