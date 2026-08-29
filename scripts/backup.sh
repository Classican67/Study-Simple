#!/usr/bin/env bash
# Sauvegarde de la base SQLite vers le NAS.
#
# La base vit sur le disque local du Xubuntu (SQLite ne supporte pas un
# partage réseau). Ce script en dépose une copie cohérente sur le NAS, ce qui
# est la contrepartie du choix « base locale, données sur le NAS ».
#
# Lancé par le timer systemd fiches-backup.timer (voir scripts/install.sh),
# ou à la main :  ./scripts/backup.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Nombre de copies conservées sur le NAS. Au-delà, la plus ancienne est effacée.
KEEP="${FICHES_BACKUP_KEEP:-30}"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
TARGET="/app/backups/fiches-${STAMP}.db"

echo "→ Sauvegarde vers ${TARGET}"

# « .backup » est l'API de sauvegarde à chaud de SQLite : elle produit un
# fichier cohérent même si l'app écrit pendant la copie. Copier le .db avec
# cp ou rsync, à l'inverse, peut capturer une base à moitié écrite.
docker compose exec -T app sqlite3 /app/data/app.db ".backup '${TARGET}'"

# Compression après coup : une base SQLite se comprime très bien.
docker compose exec -T app gzip -f "${TARGET}"

echo "→ Rotation : on garde les ${KEEP} plus récentes"
docker compose exec -T app sh -c "
  ls -1t /app/backups/fiches-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    echo \"  suppression \$old\"
    rm -f \"\$old\"
  done
"

echo "✅ Sauvegarde terminée : fiches-${STAMP}.db.gz"
