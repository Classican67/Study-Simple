#!/usr/bin/env bash
# Restauration d'une sauvegarde prise par scripts/backup.sh.
#
#   ./scripts/restore.sh fiches-2026-08-28_030000.db.gz
#
# L'app est arrêtée pendant l'opération : restaurer sous une base ouverte
# donnerait un résultat incohérent.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

BACKUP="${1:-}"
if [ -z "$BACKUP" ]; then
  echo "Usage : $0 <nom-du-fichier-de-sauvegarde>"
  echo
  echo "Sauvegardes disponibles sur le NAS :"
  docker compose exec -T app sh -c "ls -1t /app/backups/fiches-*.db.gz 2>/dev/null | head -20 | xargs -n1 basename" || true
  exit 1
fi

read -rp "Remplacer la base actuelle par ${BACKUP} ? Les données plus récentes seront perdues. [oui/N] " answer
[ "$answer" = "oui" ] || { echo "Annulé."; exit 1; }

echo "→ Arrêt de l'app"
docker compose stop app

# On repart d'un conteneur jetable : l'app est arrêtée, mais ses volumes
# restent montables.
docker compose run --rm --no-deps -T app sh -c "
  set -e
  gunzip -c '/app/backups/${BACKUP}' > /app/data/restore.db
  # On écrase la base et on retire les journaux WAL, qui appartiennent à
  # l'ancienne base et la rendraient incohérente.
  mv /app/data/restore.db /app/data/app.db
  rm -f /app/data/app.db-wal /app/data/app.db-shm
  echo '  base restaurée'
"

echo "→ Redémarrage"
docker compose start app
echo "✅ Restauration terminée."
