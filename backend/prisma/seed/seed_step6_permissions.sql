-- =====================================================================
-- Seed additif — Étape 6 : permissions exercices comptables + gestion
-- fine du plan comptable. Idempotent (ON CONFLICT), à exécuter après
-- seed_permissions_roles.sql.
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'ACCOUNTING_PERIOD.READ',   'ACCOUNTING_PERIOD', 'Consulter les exercices comptables'),
  (gen_random_uuid()::text, 'ACCOUNTING_PERIOD.CREATE', 'ACCOUNTING_PERIOD', 'Créer un exercice comptable'),
  (gen_random_uuid()::text, 'ACCOUNTING_PERIOD.CLOSE',  'ACCOUNTING_PERIOD', 'Clôturer un exercice comptable'),
  (gen_random_uuid()::text, 'ACCOUNTING_PERIOD.REOPEN', 'ACCOUNTING_PERIOD', 'Rouvrir un exercice clôturé (action restrictive)'),
  (gen_random_uuid()::text, 'ACCOUNT.DISABLE',          'ACCOUNT',           'Désactiver un compte du plan comptable'),
  (gen_random_uuid()::text, 'ACCOUNT.ENABLE',           'ACCOUNT',           'Réactiver un compte du plan comptable'),
  (gen_random_uuid()::text, 'ACCOUNT.IMPORT',           'ACCOUNT',           'Importer un plan comptable (CSV)')
ON CONFLICT (code) DO NOTHING;

-- ADMIN : toutes les nouvelles permissions (déjà couvert par la
-- sélection SELECT id FROM permissions du seed initial, mais on la
-- rejoue ici par sécurité en cas d'exécution isolée de ce fichier).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000002', id FROM permissions
WHERE code IN ('ACCOUNTING_PERIOD.READ','ACCOUNTING_PERIOD.CREATE','ACCOUNTING_PERIOD.CLOSE','ACCOUNTING_PERIOD.REOPEN','ACCOUNT.DISABLE','ACCOUNT.ENABLE','ACCOUNT.IMPORT')
ON CONFLICT DO NOTHING;

-- SUPER_ADMIN : idem.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000001', id FROM permissions
WHERE code IN ('ACCOUNTING_PERIOD.READ','ACCOUNTING_PERIOD.CREATE','ACCOUNTING_PERIOD.CLOSE','ACCOUNTING_PERIOD.REOPEN','ACCOUNT.DISABLE','ACCOUNT.ENABLE','ACCOUNT.IMPORT')
ON CONFLICT DO NOTHING;

-- DIRECTOR : lecture des exercices uniquement (déjà ACCOUNT.READ).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000003', id FROM permissions
WHERE code IN ('ACCOUNTING_PERIOD.READ')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : gère le plan comptable et les exercices au quotidien,
-- MAIS la réouverture reste réservée à l'ADMIN (action volontairement
-- plus restrictive, cf. cahier des charges Étape 6 §12).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000004', id FROM permissions
WHERE code IN ('ACCOUNTING_PERIOD.READ','ACCOUNTING_PERIOD.CREATE','ACCOUNTING_PERIOD.CLOSE','ACCOUNT.DISABLE','ACCOUNT.ENABLE','ACCOUNT.IMPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : lecture des exercices uniquement, ne gère pas
-- le plan comptable (déjà ACCOUNT.READ seul).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000005', id FROM permissions
WHERE code IN ('ACCOUNTING_PERIOD.READ')
ON CONFLICT DO NOTHING;

-- AUDITOR : lecture des exercices uniquement.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000006', id FROM permissions
WHERE code IN ('ACCOUNTING_PERIOD.READ')
ON CONFLICT DO NOTHING;

-- VIEWER : lecture des exercices uniquement.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000007', id FROM permissions
WHERE code IN ('ACCOUNTING_PERIOD.READ')
ON CONFLICT DO NOTHING;

COMMIT;
