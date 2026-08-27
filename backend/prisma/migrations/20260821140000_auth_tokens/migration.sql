-- =====================================================================
-- Migration: 20260821140000_auth_tokens
--
--   - RefreshToken : ajout de revoked_at (horodatage, en plus du
--     booléen existant), last_used_at (traçabilité), et
--     replaced_by_token_id (chaîne de rotation + détection de
--     réutilisation d'un token déjà révoqué = vol probable).
--     token_hash devient UNIQUE (un hash de token ne doit jamais
--     pouvoir être partagé entre deux lignes).
--   - PasswordResetToken (nouvelle table) : tokens de réinitialisation
--     de mot de passe, à usage unique et courte durée de vie, stockés
--     uniquement sous forme de hash (jamais en clair).
--
-- Aucune table comptable de l'Étape 3 n'est modifiée.
-- =====================================================================

ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_at" TIMESTAMP(3);
ALTER TABLE "refresh_tokens" ADD COLUMN "last_used_at" TIMESTAMP(3);
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_token_id" TEXT;

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_token_id_key" ON "refresh_tokens"("replaced_by_token_id");

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey"
  FOREIGN KEY ("replaced_by_token_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nouvelle valeur d'enum nécessaire à l'audit des révocations de
-- session (réutilisation de refresh token détectée, déconnexion forcée).
ALTER TYPE "AuditAction" ADD VALUE 'REVOKE';
