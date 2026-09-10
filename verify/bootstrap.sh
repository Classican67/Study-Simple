#!/bin/bash
# Remet le bac à sable en état : le dossier temporaire est nettoyé par le
# système sans prévenir, et Playwright comme ctx.json disparaissent.
set -e
cd "$(dirname "$0")"
if ! node -e 'import("playwright")' 2>/dev/null; then
  echo "Playwright manquant — réinstallation…"
  npm install --no-save playwright@1.53.0 >/dev/null 2>&1
  npx playwright install chromium 2>&1 | tail -1
fi
ln -sf ../node_modules/jose node_modules/jose 2>/dev/null || true
node bootstrap.mjs
