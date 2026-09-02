#!/bin/sh
# Point d'entrée du conteneur de production.
# Échoue tôt et bruyamment plutôt que de démarrer une app à moitié configurée.
set -e

if [ -z "$SESSION_SECRET" ] || [ ${#SESSION_SECRET} -lt 32 ]; then
  echo "ERREUR : SESSION_SECRET absent ou trop court (32 caractères minimum)." >&2
  echo "         Génère-le avec : openssl rand -base64 32" >&2
  echo "         puis renseigne-le dans le fichier .env à côté du docker-compose.yml." >&2
  exit 1
fi

# UPLOAD_DIR pointe vers le montage NAS : s'il est absent, c'est presque
# toujours que le partage n'est pas monté sur l'hôte. Mieux vaut le dire que
# d'écrire dans un dossier vide du conteneur, invisible et jamais sauvegardé.
if [ ! -d "$UPLOAD_DIR" ]; then
  echo "ERREUR : UPLOAD_DIR ($UPLOAD_DIR) n'existe pas dans le conteneur." >&2
  echo "         Vérifie que le partage NAS est bien monté sur l'hôte" >&2
  echo "         et que NAS_UPLOADS pointe dessus dans .env." >&2
  exit 1
fi

# `migrate deploy` n'applique que les migrations déjà versionnées et ne
# supprime jamais de colonne, contrairement à `db push`.
echo "→ Application des migrations…"
npx prisma migrate deploy

# Indexation des cartes antérieures à la recherche. Idempotent : sur une base
# déjà à jour, ne touche aucune ligne.
echo "→ Indexation de la recherche…"
npx tsx scripts/backfill-search.ts

echo "→ Démarrage de Fiches sur le port ${PORT:-3000}"
exec "$@"
