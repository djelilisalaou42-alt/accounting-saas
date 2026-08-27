-- =====================================================================
-- Seed de développement — DONNÉES 100% FICTIVES
-- Entreprise de démonstration, utilisateur admin, comptes, journaux,
-- un exercice comptable. Idempotent : peut être relancé sans dupliquer
-- (ON CONFLICT DO NOTHING sur les clés naturelles).
--
-- Identifiants de connexion de démonstration :
--   email    : admin@demo.local
--   password : Demo1234!   (hash Argon2id ci-dessous, mêmes paramètres que
--              password.util.ts — memoryCost 19456, timeCost 2, parallelism 1 ;
--              corrigé lors de la préparation au déploiement : ce hash était
--              auparavant au format bcrypt, jamais reconnu par argon2.verify(),
--              ce qui rendait le login de démonstration systématiquement
--              impossible malgré la documentation)
-- =====================================================================

BEGIN;

-- --- Entreprise de démonstration ---------------------------------------
INSERT INTO companies (id, name, legal_name, registration_number, tax_id_number, country, accounting_framework_id, currency, city, phone, email, fiscal_year_start_month, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Entreprise Démo SARL',
  'Entreprise Démo SARL',
  'RCCM-DEMO-0001',
  'IFU-DEMO-0001',
  'BJ',
  (SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'),
  'XOF',
  'Cotonou',
  '+229 00 00 00 00',
  'contact@demo.local',
  1,
  'ACTIVE',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- --- Utilisateur administrateur ------------------------------------------
INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'admin@demo.local',
  '$argon2id$v=19$m=19456,t=2,p=1$s1qC4tm4LFFBl+pgqeMcrA$daQib6y6xC+HFCIE537gjjgvHFQ+zQAQPs+fK/hrsNM', -- Demo1234! (Argon2id — corrigé lors de la préparation au déploiement, voir README)
  'Admin',
  'Démo',
  'ACTIVE',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- --- Rôle Administrateur (propre à l'entreprise démo) --------------------
INSERT INTO roles (id, company_id, name, description, is_system, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Administrateur',
  'Accès complet à l''entreprise de démonstration',
  false,
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- --- Rattachement admin <-> entreprise démo -------------------------------
INSERT INTO user_companies (id, user_id, company_id, role_id, is_default, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  true,
  now()
)
ON CONFLICT (id) DO NOTHING;

-- --- Exercice comptable 2026 -----------------------------------------------
INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'Exercice 2026',
  '2026-01-01',
  '2026-12-31',
  'OPEN',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- --- Plan comptable minimal (extrait SYSCOHADA, à titre d'exemple) --------
-- Corrigé lors de l'audit post-Étape 12 : la colonne account_class a été
-- supprimée par la migration 20260821180000_accounting_framework (Étape 6),
-- remplacée par framework_id + account_class_id (FK vers account_classes,
-- scopée par référentiel). Ce script n'avait jamais été mis à jour depuis
-- — corrigé ici sans toucher au schéma ni à aucune logique métier.
INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, nature, level, is_postable, is_active, created_at, updated_at)
SELECT v.id, v.company_id, fw.id, ac.id, v.code, v.label, v.nature::"AccountNature", 2, true, true, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '101000', 'Capital social',              '1', 'CREDIT'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '411000', 'Clients',                     '4', 'DEBIT'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '401000', 'Fournisseurs',                '4', 'CREDIT'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', '443000', 'TVA facturée',                '4', 'CREDIT'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', '445000', 'TVA déductible',              '4', 'DEBIT'),
  ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000001', '512000', 'Banque',                      '5', 'DEBIT'),
  ('00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000001', '571000', 'Caisse',                      '5', 'DEBIT'),
  ('00000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000001', '601000', 'Achats de marchandises',      '6', 'DEBIT'),
  ('00000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-000000000001', '701000', 'Ventes de marchandises',      '7', 'CREDIT')
) AS v(id, company_id, code, label, class_code, nature)
JOIN accounting_frameworks fw ON fw.code = 'SYSCOHADA_REVISED'
JOIN account_classes ac ON ac.framework_id = fw.id AND ac.code = v.class_code
ON CONFLICT (id) DO NOTHING;

-- --- Journaux ----------------------------------------------------------------
INSERT INTO journals (id, company_id, code, label, type, is_active, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'VE', 'Journal des ventes',           'SALES',     true, now(), now()),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'AC', 'Journal des achats',           'PURCHASES', true, now(), now()),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'BQ', 'Journal de banque',            'BANK',      true, now(), now()),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'CA', 'Journal de caisse',            'CASH',      true, now(), now()),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000001', 'OD', 'Journal des opérations diverses', 'GENERAL', true, now(), now())
ON CONFLICT (id) DO NOTHING;

COMMIT;
