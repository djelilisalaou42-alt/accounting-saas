#!/usr/bin/env bash
# =====================================================================
# Sauvegarde du stockage des pièces jointes — accounting-saas
#
# Les métadonnées (table attachments) et les fichiers physiques
# (ATTACHMENTS_STORAGE_PATH) forment UN SEUL ensemble cohérent : une
# restauration qui ne rétablit que la base sans les fichiers laisse
# des lignes "attachments" pointant vers des fichiers inexistants
# (déjà un cas testé côté application, voir
# AttachmentsService.download() qui lève une NotFoundException
# propre dans ce cas — mais mieux vaut ne jamais s'y retrouver en
# restaurant les deux ensemble, au même instant).
#
# Usage :
#   ATTACHMENTS_STORAGE_PATH="./storage/attachments" \
#     ./scripts/backup/backup-attachments.sh [dossier_de_sortie]
# =====================================================================
set -euo pipefail

STORAGE_PATH="${ATTACHMENTS_STORAGE_PATH:-./storage/attachments}"
BACKUP_DIR="${1:-${BACKUP_DIR:-./backups/attachments}}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="${BACKUP_DIR}/attachments_${TIMESTAMP}.tar.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if [ ! -d "$STORAGE_PATH" ]; then
  echo "ERREUR : ATTACHMENTS_STORAGE_PATH (${STORAGE_PATH}) n'existe pas — rien à sauvegarder." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "→ Sauvegarde du stockage des pièces jointes (${STORAGE_PATH}) vers ${OUTPUT_FILE}"
tar -czf "$OUTPUT_FILE" -C "$(dirname "$STORAGE_PATH")" "$(basename "$STORAGE_PATH")"

echo "→ Sauvegarde terminée : $(du -h "$OUTPUT_FILE" | cut -f1)"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  echo "→ Purge des archives de plus de ${RETENTION_DAYS} jours dans ${BACKUP_DIR}"
  find "$BACKUP_DIR" -name "attachments_*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete
fi

echo "→ IMPORTANT : sauvegardez toujours ce fichier ET le dump PostgreSQL (backup-db.sh)"
echo "  produit AU MÊME MOMENT (ou dans la même fenêtre de maintenance), pour garder les"
echo "  métadonnées 'attachments' et les fichiers physiques cohérents entre eux."
