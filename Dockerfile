# Image de production, destinée au Xubuntu qui fait tourner l'app.
FROM node:22-bookworm-slim

# openssl        : requis par le moteur Prisma.
# ca-certificates : requis pour toute connexion TLS sortante.
# sqlite3         : utilisé par scripts/backup.sh, qui appelle « .backup »
#                   pour copier la base à chaud sans risque d'incohérence.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Couche séparée : tant que package-lock.json ne bouge pas, Docker réutilise
# le cache et le rebuild ne réinstalle pas tout.
COPY package.json package-lock.json ./

# Le schéma AVANT l'installation : le `postinstall` de package.json lance
# `prisma generate`, qui échoue s'il ne trouve pas prisma/schema.prisma — et
# fait alors échouer `npm ci` tout entier. Copier ce dossier ici ne coûte
# presque rien au cache : il ne change que lorsqu'on touche au modèle de
# données, cas où il faut de toute façon régénérer.
COPY prisma ./prisma

RUN npm ci

COPY . .

# Ces deux variables ne servent qu'à faire passer le build : Next importe
# src/lib/session.ts (qui valide la clé) et touche Prisma en collectant les
# routes. Elles sont posées en préfixe du RUN et NON via ENV, pour qu'aucune
# valeur factice ne subsiste dans l'image au démarrage.
# `prisma generate` a déjà tourné au `postinstall` ; on le relance ici pour que
# le build ne dépende pas d'un script d'installation qu'une option comme
# --ignore-scripts pourrait désactiver. Quelques secondes, aucun conflit.
RUN DATABASE_URL="file:/app/data/app.db" \
    SESSION_SECRET="secret-de-build-uniquement-jamais-utilise-au-runtime" \
    sh -c "npx prisma generate && npm run build"

# On dégraisse : eslint, typescript et les typings n'ont plus d'utilité.
# Le CLI prisma, lui, est en `dependencies` car l'entrypoint l'appelle.
RUN npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Docker redémarre le conteneur si /api/health cesse de répondre.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]
