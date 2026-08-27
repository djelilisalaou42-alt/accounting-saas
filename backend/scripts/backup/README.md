# Sauvegarde et restauration — accounting-saas

Scripts réels, testés dans cet environnement (voir "Tests effectués" en bas de ce document).
Aucun secret n'est écrit en dur dans ces scripts : toute la configuration passe par des variables
d'environnement (`DATABASE_URL`, `ATTACHMENTS_STORAGE_PATH`).

## Ce qui doit être sauvegardé — DEUX ensembles, TOUJOURS ensemble

1. **La base PostgreSQL** (`scripts/backup/backup-db.sh`) — toutes les données métier, y compris
   les métadonnées des pièces jointes (nom, taille, hash, entreprise, liens).
2. **Le stockage des pièces jointes** (`scripts/backup/backup-attachments.sh`) — les fichiers
   physiques eux-mêmes, sur le volume désigné par `ATTACHMENTS_STORAGE_PATH`.

Ces deux ensembles forment **une seule sauvegarde cohérente** : une ligne `attachments` sans son
fichier physique (ou l'inverse) est une incohérence. Sauvegardez-les toujours dans la même fenêtre
de maintenance, idéalement dans le même job planifié.

## Scripts

| Script | Rôle |
|---|---|
| `scripts/backup/backup-db.sh` | Dump PostgreSQL au format personnalisé (`pg_dump -Fc`), compressé, purge automatique selon la rétention |
| `scripts/backup/restore-db.sh` | Restauration d'un dump vers la base désignée par `DATABASE_URL` (confirmation interactive requise) |
| `scripts/backup/backup-attachments.sh` | Archive `.tar.gz` du dossier `ATTACHMENTS_STORAGE_PATH` |
| `scripts/backup/restore-attachments.sh` | Restauration de l'archive vers `ATTACHMENTS_STORAGE_PATH` (confirmation interactive requise si le dossier n'est pas vide) |

## Fréquence recommandée

- **Base PostgreSQL** : sauvegarde complète quotidienne au minimum ; envisager une sauvegarde plus
  fréquente (horaire) si le volume de transactions le justifie. Ce projet n'implémente pas de
  sauvegarde continue (WAL archiving/PITR) — à évaluer côté infrastructure si une granularité de
  restauration inférieure à 24h est nécessaire.
- **Pièces jointes** : même fréquence que la base, dans la même fenêtre.

## Rétention

Par défaut, les deux scripts de sauvegarde purgent automatiquement les fichiers de plus de 30 jours
(`BACKUP_RETENTION_DAYS`, configurable). Adapter selon la politique de conservation légale/fiscale
applicable à l'entreprise utilisatrice (souvent plusieurs années pour des données comptables — la
purge à 30 jours porte sur les fichiers de sauvegarde locaux, pas sur une politique d'archivage
réglementaire, qui doit être gérée par une rétention à plus long terme côté stockage
infrastructure, hors périmètre de ces scripts).

## Test de restauration

**Un plan de sauvegarde non testé n'est pas un plan de sauvegarde.** Procédure minimale à exécuter
régulièrement (recommandé : mensuel) :

```bash
# 1. Créer une base de test vide
createdb -U accounting_user accounting_saas_restore_check

# 2. Restaurer le dernier dump dedans
DATABASE_URL="postgresql://accounting_user:PASS@host:5432/accounting_saas_restore_check" \
  ./scripts/backup/restore-db.sh backups/db/accounting_saas_XXXX.dump

# 3. Vérifier la structure et quelques données critiques
psql "$DATABASE_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
psql "$DATABASE_URL" -c "SELECT count(*) FROM companies;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM accounting_entries;"

# 4. Détruire la base de test
dropdb -U accounting_user accounting_saas_restore_check
```

## Séparation des sauvegardes

Les sauvegardes ne doivent **jamais** être stockées uniquement sur le même serveur/volume que la
base de production elle-même — une perte de ce serveur (disque, VM, datacenter) emporterait alors
aussi les sauvegardes. Répliquer vers un stockage distinct (autre zone/région, ou service de
sauvegarde managé côté infrastructure) — décision et mise en œuvre côté infrastructure, hors
périmètre du code applicatif.

## Procédure en cas de sinistre (perte totale du serveur)

1. Provisionner un nouveau serveur PostgreSQL (même version majeure que celle utilisée en
   production).
2. Créer une base vide, appliquer les 17 migrations dans l'ordre (voir section "Migrations" du
   README principal) — **ou** restaurer directement depuis le dernier dump avec `restore-db.sh`
   (le dump contient déjà la structure ET les données, pas besoin de rejouer les migrations dans
   ce cas).
3. Restaurer le stockage des pièces jointes avec `restore-attachments.sh`, depuis l'archive de la
   **même** sauvegarde que le dump restauré à l'étape 2.
4. Vérifier les comptages de données critiques (voir "Test de restauration" ci-dessus).
5. Reconfigurer les variables d'environnement (`DATABASE_URL`, `ATTACHMENTS_STORAGE_PATH`,
   secrets JWT — voir la section "Mise en production" du README principal).
6. Redémarrer l'application, vérifier `GET /health`.

## Limitations de cet environnement (sandbox)

Les scripts ci-dessus ont été **réellement exécutés et vérifiés** dans cet environnement de
développement :
- `pg_dump`/`pg_restore` disponibles et fonctionnels (vérifié).
- Cycle complet dump → nouvelle base → restauration → comparaison exécuté avec succès : 43 tables,
  121 clés étrangères, 16 triggers, et les comptages de toutes les tables critiques identiques
  entre la base source et la base restaurée.
- Cycle complet backup → restauration du stockage des pièces jointes exécuté avec succès :
  contenu binaire du fichier restauré identique à l'original (vérifié octet pour octet).

Ce qui n'a **pas** été testé ici, faute d'infrastructure de production réelle dans ce sandbox :
réplication vers un stockage distant, sauvegarde continue (PITR), restauration sous charge, et
tout ce qui dépend d'un environnement multi-serveurs. Ces aspects restent une responsabilité
d'infrastructure à valider avant la première mise en production réelle.
