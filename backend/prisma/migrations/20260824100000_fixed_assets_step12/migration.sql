-- =====================================================================
-- Étape 12 — Immobilisations et amortissements.
--
-- Inventaire préalable (voir schema.prisma) : FixedAsset et
-- DepreciationEntry existaient déjà depuis le schéma initial, avec la
-- contrainte unique (fixed_asset_id, fiscal_year) sur
-- depreciation_entries déjà en place — protection native contre la
-- double dotation, réutilisée telle quelle, aucune nouvelle contrainte
-- nécessaire sur cette table.
--
-- Ajouts réellement nécessaires :
--   A. ACQUIRED sur FixedAssetStatus (état intermédiaire "fiche créée,
--      pas encore en service", absent de l'enum existant qui démarrait
--      directement à IN_SERVICE).
--   B. asset_categories — référentiel de comptes et méthode/durée par
--      défaut, absent du schéma existant, jamais de compte codé en dur.
--   C. Colonnes manquantes sur fixed_assets (categoryId, comptes de
--      dotation, service_date, invoice_id, acquisition_entry_id,
--      location, reference, notes).
--   D. asset_disposals — trace structurée de cession, avec contrainte
--      unique sur fixed_asset_id (protection native contre la double
--      cession, même principe que depreciation_entries).
-- =====================================================================

-- A. Nouvel état intermédiaire du cycle de vie d'une immobilisation.
ALTER TYPE "FixedAssetStatus" ADD VALUE IF NOT EXISTS 'ACQUIRED';

-- Nouveau type de cession.
CREATE TYPE "AssetDisposalType" AS ENUM ('SALE', 'SCRAPPING', 'OTHER');

-- =====================================================================
-- B. CATÉGORIES D'IMMOBILISATIONS
-- =====================================================================

CREATE TABLE "asset_categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_account_id" TEXT NOT NULL,
    "depreciation_account_id" TEXT NOT NULL,
    "depreciation_expense_account_id" TEXT NOT NULL,
    "default_method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "default_useful_life_years" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_categories_company_id_code_key" ON "asset_categories"("company_id", "code");
CREATE INDEX "asset_categories_company_id_idx" ON "asset_categories"("company_id");

ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_asset_account_id_fkey" FOREIGN KEY ("asset_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_depreciation_account_id_fkey" FOREIGN KEY ("depreciation_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_depreciation_expense_account_id_fkey" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- =====================================================================
-- C. COLONNES MANQUANTES SUR fixed_assets
-- =====================================================================

ALTER TABLE "fixed_assets"
  ADD COLUMN "category_id" TEXT,
  ADD COLUMN "depreciation_account_id" TEXT,
  ADD COLUMN "depreciation_expense_account_id" TEXT,
  ADD COLUMN "invoice_id" TEXT,
  ADD COLUMN "acquisition_entry_id" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "service_date" TIMESTAMP(3);

-- Nouvelles fiches créées après cette migration démarrent à ACQUIRED —
-- mais on laisse le défaut de colonne existant (IN_SERVICE) inchangé
-- pour ne pas modifier silencieusement une convention de schéma déjà
-- en place ; le service applicatif fixe explicitement ACQUIRED à la
-- création (voir fixed-assets.service.ts), conformément au principe du
-- projet de ne jamais dépendre implicitement d'un défaut de colonne
-- pour une règle métier.

CREATE INDEX "fixed_assets_category_id_idx" ON "fixed_assets"("category_id");

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "asset_categories"("id") ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciation_account_id_fkey" FOREIGN KEY ("depreciation_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciation_expense_account_id_fkey" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "accounts"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_acquisition_entry_id_fkey" FOREIGN KEY ("acquisition_entry_id") REFERENCES "accounting_entries"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- =====================================================================
-- D. CESSIONS / SORTIES D'IMMOBILISATIONS
-- =====================================================================

CREATE TABLE "asset_disposals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "fixed_asset_id" TEXT NOT NULL,
    "disposal_date" TIMESTAMP(3) NOT NULL,
    "disposal_type" "AssetDisposalType" NOT NULL,
    "gross_value" DECIMAL(18,2) NOT NULL,
    "accumulated_depreciation" DECIMAL(18,2) NOT NULL,
    "net_book_value" DECIMAL(18,2) NOT NULL,
    "disposal_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "result" DECIMAL(18,2) NOT NULL,
    "linked_entry_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_disposals_pkey" PRIMARY KEY ("id")
);

-- Protection native contre la double cession, sous concurrence
-- incluse : une contrainte unique PostgreSQL est atomique, contrairement
-- à une simple vérification applicative (SELECT puis INSERT), qui
-- laisserait une fenêtre de course. Même principe que
-- depreciation_entries(fixed_asset_id, fiscal_year).
CREATE UNIQUE INDEX "asset_disposals_fixed_asset_id_key" ON "asset_disposals"("fixed_asset_id");
CREATE INDEX "asset_disposals_company_id_idx" ON "asset_disposals"("company_id");

ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_fixed_asset_id_fkey" FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_assets"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_linked_entry_id_fkey" FOREIGN KEY ("linked_entry_id") REFERENCES "accounting_entries"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
