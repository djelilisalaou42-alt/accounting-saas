#!/bin/sh
# =====================================================================
# Entrypoint Docker — backend accounting-saas.
#
# Ce projet applique ses migrations en SQL brut via `psql` (jamais
# `prisma migrate deploy` — voir README "Limites connues" : le moteur
# Prisma Migrate nécessite un accès réseau non disponible dans le
# sandbox de développement, workaround déjà établi et documenté). Sans
# suivi natif de "quelles migrations sont déjà appliquées" fourni par
# cet outil, ce script tient son PROPRE registre minimal
# (`_manual_migrations`) pour rester idempotent : rejouable à chaque
# redémarrage du conteneur sans jamais retenter une migration déjà
# appliquée.
#
# Les seeds de permissions/rôles (seed_step*.sql) sont, eux, déjà
# idempotents par construction (`ON CONFLICT DO NOTHING`) — rejoués à
# chaque démarrage sans registre séparé, c'est sans risque.
#
# Le seed de démonstration (`seed.sql`, données 100% fictives) n'est
# JAMAIS exécuté automatiquement — uniquement si SEED_DEMO_DATA=true
# est explicitement positionné (jamais la valeur par défaut).
# =====================================================================
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERREUR : DATABASE_URL doit être défini." >&2
  exit 1
fi

echo "→ Attente de PostgreSQL..."
ATTEMPTS=0
until psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 30 ]; then
    echo "ERREUR : PostgreSQL injoignable après 30 tentatives." >&2
    exit 1
  fi
  sleep 2
done
echo "→ PostgreSQL disponible."

echo "→ Vérification du registre de migrations..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  CREATE TABLE IF NOT EXISTS _manual_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
"

echo "→ Application des migrations en attente..."
for f in /app/prisma/migrations/*/migration.sql; do
  name=$(basename "$(dirname "$f")")
  already_applied=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM _manual_migrations WHERE filename = '${name}'")
  if [ "$already_applied" = "1" ]; then
    echo "  - ${name} : déjà appliquée, ignorée."
  else
    echo "  - ${name} : application..."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "INSERT INTO _manual_migrations (filename) VALUES ('${name}')"
  fi
done
echo "→ Migrations à jour."

echo "→ Application des seeds de permissions/rôles (idempotents)..."
for f in seed_permissions_roles seed_step6_permissions seed_step7_permissions seed_step9_permissions \
         seed_step10_permissions seed_step11_permissions seed_step12_permissions seed_step13_permissions \
         seed_step14_permissions seed_step16_permissions seed_step17_permissions; do
  path="/app/prisma/seed/${f}.sql"
  if [ -f "$path" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$path"
  fi
done
echo "→ Permissions à jour."

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "⚠️  SEED_DEMO_DATA=true — application du seed de démonstration (DONNÉES FICTIVES, jamais en production réelle)."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f /app/prisma/seed/seed.sql
fi

echo "→ Démarrage de l'application : $*"
exec "$@"
