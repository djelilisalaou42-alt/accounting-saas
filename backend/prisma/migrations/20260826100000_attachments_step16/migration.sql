-- =====================================================================
-- Étape 16 — Pièces jointes.
--
-- Inventaire préalable (voir schema.prisma) : Attachment existait déjà
-- depuis le schéma initial (Étape 2), avec une conception à FK
-- multiples nullables (accounting_entry_id, invoice_id, fixed_asset_id,
-- tax_declaration_id) plutôt que polymorphe — CONSERVÉE TELLE QUELLE
-- (voir README pour le raisonnement) : ajouter budget_id suit
-- exactement le même principe plutôt que d'introduire un système
-- polymorphe qui romprait la cohérence avec l'existant. Aucun système
-- de stockage (S3/MinIO) n'existe dans le projet ; fileUrl est
-- réutilisé comme clé de stockage interne sur disque local (jamais une
-- URL publique), servi exclusivement via un endpoint applicatif
-- vérifiant companyId/permissions à chaque téléchargement.
--
-- Colonnes ajoutées : sha256 (intégrité/détection de doublon),
-- description, category (type de document libre), budget_id (seul
-- rattachement métier manquant — Company/AccountingEntry/Invoice/
-- FixedAsset/TaxDeclaration avaient déjà leur relation attachments).
-- =====================================================================

ALTER TABLE "attachments"
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "budget_id" TEXT;

CREATE INDEX "attachments_fixed_asset_id_idx" ON "attachments"("fixed_asset_id");
CREATE INDEX "attachments_tax_declaration_id_idx" ON "attachments"("tax_declaration_id");
CREATE INDEX "attachments_budget_id_idx" ON "attachments"("budget_id");

-- Même politique de suppression que les FK existantes sur cette table
-- (ON DELETE SET NULL) : la pièce jointe et son fichier survivent à la
-- suppression de l'objet métier rattaché, jamais supprimés en cascade.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON UPDATE CASCADE ON DELETE SET NULL;
