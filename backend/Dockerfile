# =====================================================================
# Backend accounting-saas — image de production (multi-stage).
#
# Base debian-slim plutôt qu'Alpine : `argon2` (hachage des mots de
# passe, voir password.util.ts) est un module natif — musl libc
# (Alpine) est une source connue de problèmes subtils avec ce type de
# dépendance. Le coût en taille d'image (quelques dizaines de Mo) est
# largement justifié pour un composant aussi critique que
# l'authentification.
#
# Étape "builder" : installe toutes les dépendances (dev incluses),
# génère le client Prisma, compile TypeScript. Étape "runtime" :
# dépendances de production uniquement, code compilé, fichiers SQL de
# migrations/seeds (raw SQL — jamais générés par `prisma migrate`,
# voir README section "Limites connues").
# =====================================================================

FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
# `prisma generate` nécessite un accès réseau vers binaries.prisma.sh —
# disponible dans un environnement de build Docker normal (contrairement
# au sandbox de développement de ce projet, voir README "Limites
# connues"). Un échec ici doit arrêter le build : mieux vaut un échec
# explicite qu'une image livrée sans client Prisma fonctionnel.
RUN npx prisma generate

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# --- Runtime -------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# postgresql-client fournit `psql`, utilisé par docker-entrypoint.sh
# pour appliquer les migrations/seeds SQL bruts (voir plus haut).
# curl : utilisé uniquement par HEALTHCHECK ci-dessous.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r accounting && useradd -r -g accounting accounting

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

# Le stockage des pièces jointes doit être monté en volume externe
# persistant (voir docker-compose.prod.yml) — créé ici pour que
# l'application puisse y écrire même avant qu'un volume ne soit
# attaché (fs.mkdir recursive s'en charge aussi au runtime, voir
# attachments.service.ts).
RUN mkdir -p /app/storage/attachments && chown -R accounting:accounting /app

USER accounting

EXPOSE 3001

# Sonde de santé Docker native — réutilise l'endpoint /health déjà
# construit et testé (voir src/modules/health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
