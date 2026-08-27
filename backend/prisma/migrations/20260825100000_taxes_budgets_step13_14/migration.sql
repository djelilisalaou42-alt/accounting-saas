-- =====================================================================
-- Étape 13 (Taxes/déclarations fiscales) + Étape 14 (Budgets).
--
-- Inventaire préalable (voir schema.prisma) : Tax, TaxDeclaration,
-- Budget, BudgetLine existaient déjà depuis le schéma initial (Étape
-- 2). Tax est un référentiel GLOBAL par pays (jamais dupliqué par
-- entreprise, même principe qu'AccountingFramework/AccountClass) —
-- conservé tel quel. La contrainte unique existante sur BudgetLine
-- (budgetId, accountId, month) protège déjà nativement contre un
-- doublon de ligne budgétaire — réutilisée telle quelle.
--
-- Ajouts réellement nécessaires :
--   A. TaxType sur Tax (champ "type" du cahier des charges, absent).
--   B. CompanyTaxSettings — configuration PAR ENTREPRISE des comptes
--      réels portant la TVA collectée/déductible/à décaisser pour une
--      taxe du référentiel global (jamais de compte codé en dur).
--   C. Colonnes manquantes sur TaxDeclaration (montants calculés,
--      paiement, écriture liée, traçabilité) + contrainte unique
--      (companyId, taxId, periodStart, periodEnd) protégeant nativement
--      contre une déclaration en double pour une même période.
--   D. Colonnes manquantes sur Budget (description, créateur) +
--      contrainte unique (companyId, periodId, name) protégeant contre
--      un budget en double pour un même exercice.
-- =====================================================================

-- A. Type de taxe (TVA / retenue à la source / autre).
CREATE TYPE "TaxType" AS ENUM ('VAT', 'WITHHOLDING', 'OTHER');
ALTER TABLE "taxes" ADD COLUMN "type" "TaxType" NOT NULL DEFAULT 'VAT';

-- =====================================================================
-- B. CONFIGURATION FISCALE PAR ENTREPRISE
-- =====================================================================

CREATE TABLE "company_tax_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL,
    "collected_account_id" TEXT,
    "deductible_account_id" TEXT,
    "payable_account_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_tax_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_tax_settings_company_id_tax_id_key" ON "company_tax_settings"("company_id", "tax_id");
CREATE INDEX "company_tax_settings_company_id_idx" ON "company_tax_settings"("company_id");

ALTER TABLE "company_tax_settings" ADD CONSTRAINT "company_tax_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "company_tax_settings" ADD CONSTRAINT "company_tax_settings_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "company_tax_settings" ADD CONSTRAINT "company_tax_settings_collected_account_id_fkey" FOREIGN KEY ("collected_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "company_tax_settings" ADD CONSTRAINT "company_tax_settings_deductible_account_id_fkey" FOREIGN KEY ("deductible_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "company_tax_settings" ADD CONSTRAINT "company_tax_settings_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- =====================================================================
-- C. COLONNES MANQUANTES SUR tax_declarations
-- =====================================================================

ALTER TABLE "tax_declarations"
  ADD COLUMN "collected_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "deductible_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "net_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "amount_paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "credit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "linked_entry_id" TEXT,
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "validated_by_id" TEXT,
  ADD COLUMN "validated_at" TIMESTAMP(3);

-- Protection native contre une déclaration en double pour une même
-- entreprise/taxe/période, atomique sous concurrence (contrainte
-- unique PostgreSQL) — même principe que
-- depreciation_entries(fixedAssetId, fiscalYear) à l'Étape 12.
CREATE UNIQUE INDEX "tax_declarations_company_id_tax_id_period_start_period_end_key" ON "tax_declarations"("company_id", "tax_id", "period_start", "period_end");

ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_linked_entry_id_fkey" FOREIGN KEY ("linked_entry_id") REFERENCES "accounting_entries"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- =====================================================================
-- D. COLONNES MANQUANTES SUR budgets
-- =====================================================================

ALTER TABLE "budgets"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "created_by_id" TEXT;

-- Protection native contre un budget en double pour un même exercice
-- (même principe que fixed_assets(companyId, code)).
CREATE UNIQUE INDEX "budgets_company_id_period_id_name_key" ON "budgets"("company_id", "period_id", "name");

ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
