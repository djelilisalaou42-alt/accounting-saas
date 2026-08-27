#!/usr/bin/env bash
# =====================================================================
# Restauration PostgreSQL — accounting-saas
#
# Restaure un dump produit par backup-db.sh (format personnalisé
# pg_dump -Fc) vers une base cible — par défaut une base VIDE, jamais
# la base de production sans confirmation explicite.
#
# NE CONTIENT AUCUN SECRET : connexion via DATABASE_URL uniquement.
#
# Usage :
#   DATABASE_URL="postgresql://user:pass@host:5432/nom_de_la_base" \
#     ./scripts/backup/restore-db.sh chemin/vers/le.dump
#
# La base cible désignée par DATABASE_URL doit déjà exister et être
# vide (ou acceptez l'écrasement — voir --clean ci-dessous, qui
# supprime les objets existants avant de les recréer : à utiliser
# uniquement en connaissance de cause, jamais sur une base contenant
# des données que vous voulez conserver).
# =====================================================================
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERREUR : DATABASE_URL doit être défini (jamais de mot de passe en dur dans ce script)." >&2
  exit 1
fi

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage : $0 chemin/vers/le.dump" >&2
  echo "ERREUR : fichier de dump introuvable : ${DUMP_FILE}" >&2
  exit 1
fi

echo "⚠️  Restauration vers la base désignée par DATABASE_URL."
echo "    Cette opération peut écraser des données existantes selon l'état de la base cible."
read -r -p "Confirmer la restauration depuis ${DUMP_FILE} ? (taper 'oui' pour continuer) " CONFIRM
if [ "$CONFIRM" != "oui" ]; then
  echo "Restauration annulée."
  exit 1
fi

echo "→ Restauration en cours depuis ${DUMP_FILE}"
pg_restore \
  --dbname="$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --verbose \
  "$DUMP_FILE"

echo "→ Restauration terminée."
echo "→ Vérifications recommandées après restauration :"
echo "   - psql \"\$DATABASE_URL\" -c \"SELECT count(*) FROM companies;\""
echo "   - psql \"\$DATABASE_URL\" -c \"SELECT count(*) FROM accounting_entries;\""
echo "   - psql \"\$DATABASE_URL\" -c \"SELECT count(*) FROM attachments;\" (puis comparer avec les fichiers physiques restaurés, voir backup-attachments.sh)"
