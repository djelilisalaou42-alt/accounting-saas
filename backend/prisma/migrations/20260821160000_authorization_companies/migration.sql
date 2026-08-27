-- =====================================================================
-- Migration: 20260821160000_authorization_companies
--
-- Nécessaire pour l'Étape 5 (Autorisation, rôles, permissions,
-- gestion des entreprises) :
--   - users.is_super_admin : séparation stricte SUPER_ADMIN (plateforme)
--     / ADMIN (par entreprise, via Role+UserCompany). Défaut false,
--     jamais positionné automatiquement.
--   - user_companies : ajout de status (ACTIVE/DISABLED/REMOVED),
--     disabled_at/disabled_by_id (désactivation tracée, jamais de
--     suppression physique d'un membre ayant déjà participé à la
--     comptabilité), invitation_id (traçabilité de l'invitation
--     d'origine, remplace le champ libre invited_by).
--   - company_invitations (nouvelle table) : invitations à rejoindre
--     une entreprise, token à usage unique stocké en hash uniquement.
--   - AuditAction : 9 nouvelles valeurs pour les événements
--     d'autorisation/gestion d'entreprise.
--
-- Aucune table comptable des Étapes 2-3 n'est modifiée.
-- =====================================================================

CREATE TYPE "UserCompanyStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REMOVED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

ALTER TABLE "users" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "user_companies" ADD COLUMN "status" "UserCompanyStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "user_companies" ADD COLUMN "disabled_at" TIMESTAMP(3);
ALTER TABLE "user_companies" ADD COLUMN "disabled_by_id" TEXT;
ALTER TABLE "user_companies" ADD COLUMN "invitation_id" TEXT;

CREATE UNIQUE INDEX "user_companies_invitation_id_key" ON "user_companies"("invitation_id");
CREATE INDEX "user_companies_company_id_status_idx" ON "user_companies"("company_id", "status");

ALTER TABLE "user_companies"
  ADD CONSTRAINT "user_companies_disabled_by_id_fkey"
  FOREIGN KEY ("disabled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "company_invitations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_invitations_token_hash_key" ON "company_invitations"("token_hash");
CREATE INDEX "company_invitations_company_id_idx" ON "company_invitations"("company_id");
CREATE INDEX "company_invitations_email_idx" ON "company_invitations"("email");
CREATE INDEX "company_invitations_token_hash_idx" ON "company_invitations"("token_hash");

ALTER TABLE "company_invitations"
  ADD CONSTRAINT "company_invitations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_invitations"
  ADD CONSTRAINT "company_invitations_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_invitations"
  ADD CONSTRAINT "company_invitations_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_companies"
  ADD CONSTRAINT "user_companies_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "company_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_INVITE';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_ROLE_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_DISABLE';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_ENABLE';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_REMOVE';
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_SWITCH';
ALTER TYPE "AuditAction" ADD VALUE 'PERMISSION_DENIED';
