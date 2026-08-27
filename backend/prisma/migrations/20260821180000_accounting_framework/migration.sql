-- =====================================================================
-- Migration: 20260821180000_accounting_framework
--
-- Étape 6 : le plan comptable devient piloté par les données.
--   - accounting_frameworks (référentiel : SYSCOHADA, PCG...), séparé
--     du pays de l'entreprise.
--   - account_classes remplace l'ancien enum "AccountClass" figé —
--     chaque classe porte désormais code/nom/description/nature/
--     catégorie/ordre d'affichage, rattachée à un référentiel.
--   - accounts : ajout de framework_id (dénormalisé, imposé par
--     trigger), account_class_id (remplace account_class), level
--     (profondeur hiérarchique), is_postable (compte de mouvement vs
--     regroupement).
--   - companies : ajout de accounting_framework_id.
--   - Les comptes existants (Étapes 3/5, données de démo/test) sont
--     migrés automatiquement vers le référentiel SYSCOHADA_REVISED —
--     aucune perte de données.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Référentiels comptables
-- ---------------------------------------------------------------------

CREATE TABLE "accounting_frameworks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_frameworks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_frameworks_code_key" ON "accounting_frameworks"("code");

INSERT INTO "accounting_frameworks" (id, code, name, description, is_active, created_at, updated_at)
VALUES (
  'af000000-0000-0000-0000-000000000001',
  'SYSCOHADA_REVISED',
  'SYSCOHADA Révisé',
  'Système Comptable OHADA révisé, applicable dans les 17 États membres de l''OHADA.',
  true, now(), now()
);

-- Second référentiel préparé (structure uniquement, aucune classe
-- seedée pour l'instant) pour prouver que l'architecture n'est pas
-- couplée à SYSCOHADA — voir REVUE-ETAPE-6.md.
INSERT INTO "accounting_frameworks" (id, code, name, description, is_active, created_at, updated_at)
VALUES (
  'af000000-0000-0000-0000-000000000002',
  'PCG_FR',
  'Plan Comptable Général (France)',
  'Référentiel réservé pour une extension future — structure technique seule, aucune classe encore seedée.',
  false, now(), now()
);

-- ---------------------------------------------------------------------
-- 2. Classes comptables (données, plus un enum figé)
-- ---------------------------------------------------------------------

CREATE TYPE "AccountCategory" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'OTHER');

CREATE TABLE "account_classes" (
    "id" TEXT NOT NULL,
    "framework_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "nature" "AccountNature" NOT NULL DEFAULT 'BOTH',
    "category" "AccountCategory" NOT NULL DEFAULT 'OTHER',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "account_classes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "account_classes_framework_id_code_key" ON "account_classes"("framework_id", "code");
CREATE INDEX "account_classes_framework_id_idx" ON "account_classes"("framework_id");
ALTER TABLE "account_classes" ADD CONSTRAINT "account_classes_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "accounting_frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Les 9 classes SYSCOHADA révisé, avec métadonnées complètes.
INSERT INTO "account_classes" (id, framework_id, code, name, description, nature, category, display_order, created_at, updated_at) VALUES
  ('ac000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', '1', 'Comptes de ressources durables', 'Capitaux propres, dettes financières et ressources assimilées.', 'CREDIT', 'EQUITY',    1, now(), now()),
  ('ac000000-0000-0000-0000-000000000002', 'af000000-0000-0000-0000-000000000001', '2', 'Comptes d''actif immobilisé',    'Immobilisations incorporelles, corporelles et financières.',      'DEBIT',  'ASSET',     2, now(), now()),
  ('ac000000-0000-0000-0000-000000000003', 'af000000-0000-0000-0000-000000000001', '3', 'Comptes de stocks',              'Stocks et en-cours.',                                              'DEBIT',  'ASSET',     3, now(), now()),
  ('ac000000-0000-0000-0000-000000000004', 'af000000-0000-0000-0000-000000000001', '4', 'Comptes de tiers',               'Clients, fournisseurs et comptes rattachés.',                      'BOTH',   'OTHER',     4, now(), now()),
  ('ac000000-0000-0000-0000-000000000005', 'af000000-0000-0000-0000-000000000001', '5', 'Comptes de trésorerie',          'Banques, caisses et valeurs assimilées.',                          'DEBIT',  'ASSET',     5, now(), now()),
  ('ac000000-0000-0000-0000-000000000006', 'af000000-0000-0000-0000-000000000001', '6', 'Comptes de charges',             'Charges des activités ordinaires.',                                'DEBIT',  'EXPENSE',   6, now(), now()),
  ('ac000000-0000-0000-0000-000000000007', 'af000000-0000-0000-0000-000000000001', '7', 'Comptes de produits',            'Produits des activités ordinaires.',                               'CREDIT', 'REVENUE',   7, now(), now()),
  ('ac000000-0000-0000-0000-000000000008', 'af000000-0000-0000-0000-000000000001', '8', 'Autres charges et produits',     'Charges et produits hors activités ordinaires (HAO).',             'BOTH',   'OTHER',     8, now(), now()),
  ('ac000000-0000-0000-0000-000000000009', 'af000000-0000-0000-0000-000000000001', '9', 'Comptabilité analytique et engagements hors bilan', 'Engagements donnés/reçus, comptabilité analytique.', 'BOTH', 'OTHER', 9, now(), now());

-- ---------------------------------------------------------------------
-- 3. Company : référentiel comptable utilisé
-- ---------------------------------------------------------------------

ALTER TABLE "companies" ADD COLUMN "accounting_framework_id" TEXT;
ALTER TABLE "companies" ADD CONSTRAINT "companies_accounting_framework_id_fkey" FOREIGN KEY ("accounting_framework_id") REFERENCES "accounting_frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Les entreprises déjà créées (Étapes 3/5) sont rattachées à SYSCOHADA
-- par défaut — comportement de migration, jamais silencieux pour les
-- nouvelles entreprises (assigné explicitement par CompaniesService).
UPDATE "companies" SET "accounting_framework_id" = 'af000000-0000-0000-0000-000000000001' WHERE "accounting_framework_id" IS NULL;

-- ---------------------------------------------------------------------
-- 4. Account : nouvelles colonnes + migration des données existantes
-- ---------------------------------------------------------------------

ALTER TABLE "accounts" ADD COLUMN "framework_id" TEXT;
ALTER TABLE "accounts" ADD COLUMN "account_class_id" TEXT;
ALTER TABLE "accounts" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "accounts" ADD COLUMN "is_postable" BOOLEAN NOT NULL DEFAULT true;

-- Backfill : chaque compte existant reçoit le framework SYSCOHADA et la
-- classe correspondant à son ancienne valeur d'enum account_class.
UPDATE "accounts" SET
  "framework_id" = 'af000000-0000-0000-0000-000000000001',
  "account_class_id" = CASE "account_class"
    WHEN 'CLASS_1' THEN 'ac000000-0000-0000-0000-000000000001'
    WHEN 'CLASS_2' THEN 'ac000000-0000-0000-0000-000000000002'
    WHEN 'CLASS_3' THEN 'ac000000-0000-0000-0000-000000000003'
    WHEN 'CLASS_4' THEN 'ac000000-0000-0000-0000-000000000004'
    WHEN 'CLASS_5' THEN 'ac000000-0000-0000-0000-000000000005'
    WHEN 'CLASS_6' THEN 'ac000000-0000-0000-0000-000000000006'
    WHEN 'CLASS_7' THEN 'ac000000-0000-0000-0000-000000000007'
    WHEN 'CLASS_8' THEN 'ac000000-0000-0000-0000-000000000008'
    WHEN 'CLASS_9' THEN 'ac000000-0000-0000-0000-000000000009'
  END,
  -- Heuristique de secours pour le niveau des comptes déjà existants
  -- (créés avant que "level" n'existe) : approximé depuis la longueur
  -- du code. Les comptes créés à partir de maintenant reçoivent un
  -- niveau calculé explicitement par AccountsService, jamais déduit de
  -- la longueur du code (voir règle de numérotation, REVUE-ETAPE-6.md).
  "level" = CASE
    WHEN length("code") <= 1 THEN 1
    WHEN length("code") <= 2 THEN 2
    WHEN length("code") <= 3 THEN 3
    WHEN length("code") <= 4 THEN 4
    ELSE 5
  END;

ALTER TABLE "accounts" ALTER COLUMN "framework_id" SET NOT NULL;
ALTER TABLE "accounts" ALTER COLUMN "account_class_id" SET NOT NULL;

DROP INDEX IF EXISTS "accounts_company_id_account_class_idx";
ALTER TABLE "accounts" DROP COLUMN "account_class";
DROP TYPE "AccountClass";

CREATE INDEX "accounts_company_id_account_class_id_idx" ON "accounts"("company_id", "account_class_id");
CREATE INDEX "accounts_framework_id_idx" ON "accounts"("framework_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "accounting_frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_class_id_fkey" FOREIGN KEY ("account_class_id") REFERENCES "account_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- 5. Nouvelles actions d'audit
-- ---------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_DISABLE';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_ENABLE';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_IMPORT';
