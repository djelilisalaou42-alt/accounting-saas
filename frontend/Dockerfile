# =====================================================================
# Frontend accounting-saas — image de production (multi-stage), basée
# sur la sortie "standalone" de Next.js (next.config.js) : ne trace et
# ne copie que les node_modules réellement utilisés au runtime, image
# nettement plus légère qu'une copie complète.
#
# IMPORTANT — NEXT_PUBLIC_API_URL est inlinée dans le bundle JavaScript
# AU MOMENT DU BUILD (comportement standard de Next.js pour les
# variables NEXT_PUBLIC_*, jamais lue dynamiquement au démarrage du
# conteneur). Elle DOIT donc être fournie comme build-arg :
#
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.votre-domaine.example/api/v1 .
#
# La définir uniquement comme variable d'environnement au `docker run`/
# dans docker-compose.yml serait sans effet — voir docker-compose.prod.yml.
# =====================================================================

FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

ARG NEXT_PUBLIC_API_URL=https://accounting-saas-backend.onrender.com/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY . .
RUN npm run build

# --- Runtime -------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r nextjs && useradd -r -g nextjs nextjs

# Sortie "standalone" : un server.js autonome + les seuls
# node_modules réellement nécessaires (déjà tracés par Next.js) —
# jamais besoin d'un `npm ci` supplémentaire dans cette étape.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN chown -R nextjs:nextjs /app
USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
