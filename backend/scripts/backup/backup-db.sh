#!/usr/bin/env bash
# =====================================================================
# Sauvegarde PostgreSQL — accounting-saas
#
# Réalise un dump complet de la base au format personnalisé pg_dump
# (-Fc), compressé, restaurable sélectivement avec pg_restore.
#
# NE CONTIENT AUCUN SECRET : la connexion utilise exclusivement
# DATABASE_URL (variable d'environnement), jamais un mot de passe
# écrit en dur. Ne jamais committer les fichiers .dump produits.
#
# Usage :
#   DATABASE_URL="postgresql://user:pass@host:5432/accounting_saas" \
#     ./scripts/backup/backup-db.sh [dossier_de_sortie]
#
# Variables :
#   DATABASE_URL   (obligatoire) — connexion à la base à sauvegarder.
#   BACKUP_DIR     (optionnel) — dossier de sortie, défaut ./backups/db
#   BACKUP_RETENTION_DAYS (optionnel) — purge des dumps plus anciens
#                  que N jours après une sauvegarde réussie, défaut 30.
# =====================================================================
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERREUR : DATABASE_URL doit être défini (jamais de mot de passe en dur dans ce script)." >&2
  exit 1
fi

BACKUP_DIR="${1:-${BACKUP_DIR:-./backups/db}}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="${BACKUP_DIR}/accounting_saas_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "→ Sauvegarde de la base vers ${OUTPUT_FILE}"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$OUTPUT_FILE"

echo "→ Sauvegarde terminée : $(du -h "$OUTPUT_FILE" | cut -f1)"

# Purge des sauvegardes plus anciennes que la rétention configurée —
# UNIQUEMENT après un dump réussi (set -e garantit qu'on n'arrive pas
# ici si pg_dump a échoué).
if [ "$RETENTION_DAYS" -gt 0 ]; then
  echo "→ Purge des sauvegardes de plus de ${RETENTION_DAYS} jours dans ${BACKUP_DIR}"
  find "$BACKUP_DIR" -name "accounting_saas_*.dump" -type f -mtime "+${RETENTION_DAYS}" -print -delete
fi

echo "→ Sauvegarde PostgreSQL terminée avec succès."
