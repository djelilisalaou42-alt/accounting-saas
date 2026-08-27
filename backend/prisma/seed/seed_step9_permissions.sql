-- =====================================================================
-- Seed additif — Étape 9 : permissions lettrage. Aucune permission
-- LETTERING.* n'existait avant cette étape (vérifié par inventaire).
-- Convention MODULE.ACTION déjà établie (ENTRY.*, JOURNAL.*, REPORT.*).
-- Idempotent (ON CONFLICT).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'LETTERING.READ',     'LETTERING', 'Consulter les lettrages et les lignes non lettrées'),
  (gen_random_uuid()::text, 'LETTERING.CREATE',   'LETTERING', 'Créer un lettrage (associer des lignes)'),
  (gen_random_uuid()::text, 'LETTERING.CLOSE',    'LETTERING', 'Clôturer un lettrage'),
  (gen_random_uuid()::text, 'LETTERING.UNLETTER', 'LETTERING', 'Défaire un lettrage (délettrage)'),
  (gen_random_uuid()::text, 'LETTERING.AUTO',     'LETTERING', 'Obtenir des suggestions de lettrage automatique')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code LIKE 'LETTERING.%'
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : lettrage complet (création, clôture, délettrage, suggestions).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('LETTERING.READ', 'LETTERING.CREATE', 'LETTERING.CLOSE', 'LETTERING.UNLETTER', 'LETTERING.AUTO')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : peut proposer/créer des lettrages mais pas les
-- clôturer ni les défaire (cohérent avec son absence de ENTRY.VALIDATE
-- depuis l'Étape 7 — même niveau de responsabilité).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT'
  AND p.code IN ('LETTERING.READ', 'LETTERING.CREATE', 'LETTERING.AUTO')
ON CONFLICT DO NOTHING;

-- DIRECTOR / AUDITOR / VIEWER : lecture seule (cohérent avec REPORT.READ
-- déjà accordé à ces rôles depuis l'Étape 8).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('DIRECTOR', 'AUDITOR', 'VIEWER')
  AND p.code = 'LETTERING.READ'
ON CONFLICT DO NOTHING;

COMMIT;
