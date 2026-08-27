-- =====================================================================
-- Migration: 20260821150000_audit_actions_auth
--
-- Ajoute les valeurs d'AuditAction nécessaires pour journaliser
-- précisément chaque événement d'authentification demandé (Étape 4) :
-- REGISTER, LOGOUT_ALL, REFRESH, PASSWORD_CHANGE,
-- PASSWORD_RESET_REQUEST, PASSWORD_RESET (REVOKE existe déjà depuis
-- 20260821140000_auth_tokens). Aucune table modifiée.
-- =====================================================================

ALTER TYPE "AuditAction" ADD VALUE 'REGISTER';
ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT_ALL';
ALTER TYPE "AuditAction" ADD VALUE 'REFRESH';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET';
