#!/usr/bin/env bash
# =====================================================================
# Restauration du stockage des pièces jointes — accounting-saas
#
# À exécuter DANS LA MÊME opération que restore-db.sh, avec un dump
# PostgreSQL et une archive de pièces jointes provenant de la MÊME
# sauvegarde (même fenêtre temporelle) — restaurer l'un sans l'autre
# laisse les métadonnées et les fichiers incohérents entre eux.
#
# Usage :
#   ATTACHMENTS_STORAGE_PATH="./storage/attachments" \
#     ./scripts/backup/restore-attachments.sh chemin/vers/attachments_XXXX.tar.gz
# =====================================================================
set -euo pipefail

ARCHIVE_FILE="${1:-}"
STORAGE_PATH="${ATTACHMENTS_STORAGE_PATH:-./storage/attachments}"

if [ -z "$ARCHIVE_FILE" ] || [ ! -f "$ARCHIVE_FILE" ]; then
  echo "Usage : $0 chemin/vers/attachments_XXXX.tar.gz" >&2
  echo "ERREUR : archive introuvable : ${ARCHIVE_FILE}" >&2
  exit 1
fi

if [ -d "$STORAGE_PATH" ] && [ -n "$(ls -A "$STORAGE_PATH" 2>/dev/null)" ]; then
  echo "⚠️  ${STORAGE_PATH} existe déjà et n'est pas vide."
  read -r -p "Écraser son contenu avec l'archive ? (taper 'oui' pour continuer) " CONFIRM
  if [ "$CONFIRM" != "oui" ]; then
    echo "Restauration annulée."
    exit 1
  fi
  rm -rf "${STORAGE_PATH:?}"/*
fi

mkdir -p "$(dirname "$STORAGE_PATH")"

echo "→ Restauration de l'archive ${ARCHIVE_FILE} vers $(dirname "$STORAGE_PATH")"
tar -xzf "$ARCHIVE_FILE" -C "$(dirname "$STORAGE_PATH")"

echo "→ Restauration terminée."
echo "→ Vérification recommandée : comparer le nombre de fichiers restaurés avec"
echo "   SELECT count(*) FROM attachments; (après restore-db.sh de la MÊME sauvegarde)"
