-- Étape 11 (suite) — Ajout de CANCELED à ReconciliationStatus. Les
-- champs canceled_at/canceled_by_id (migration précédente) marquent
-- QUAND/QUI a annulé, ce statut marque explicitement QUE la session
-- est annulée (plutôt que de surcharger COMPLETED avec un champ
-- canceled_at ambigu). Cohérent avec le principe déjà appliqué pour
-- Lettering.canceledAt (Étape 9), ici formalisé par un statut dédié
-- car ReconciliationStatus est un enum fermé, contrairement au
-- lettrage qui dérive son statut de plusieurs booléens.
ALTER TYPE "ReconciliationStatus" ADD VALUE IF NOT EXISTS 'CANCELED';
