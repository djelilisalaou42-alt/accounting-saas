-- =====================================================================
-- Seed additif — Étape 14 : permissions budgets. Aucune permission
-- BUDGET.* n'existait avant cette étape. Convention MODULE.ACTION
-- déjà établie. Idempotent (ON CONFLICT).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'BUDGET.READ',     'BUDGET', 'Consulter les budgets et l''analyse budget/réalisé'),
  (gen_random_uuid()::text, 'BUDGET.CREATE',   'BUDGET', 'Créer un budget et ses lignes'),
  (gen_random_uuid()::text, 'BUDGET.UPDATE',   'BUDGET', 'Modifier un budget en brouillon et ses lignes'),
  (gen_random_uuid()::text, 'BUDGET.VALIDATE', 'BUDGET', 'Activer/clôturer un budget'),
  (gen_random_uuid()::text, 'BUDGET.EXPORT',   'BUDGET', 'Exporter l''analyse budget/réalisé')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code IN ('BUDGET.READ','BUDGET.CREATE','BUDGET.UPDATE','BUDGET.VALIDATE','BUDGET.EXPORT')
ON CONFLICT DO NOTHING;

-- DIRECTOR : pilotage budgétaire complet — le budget est un outil de
-- pilotage, cohérent avec le rôle DIRECTOR déjà défini pour cet usage
-- ("Accès aux données et rapports de l'entreprise").
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'DIRECTOR'
  AND p.code IN ('BUDGET.READ','BUDGET.CREATE','BUDGET.UPDATE','BUDGET.VALIDATE','BUDGET.EXPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : gestion comptable complète, y compris les budgets.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('BUDGET.READ','BUDGET.CREATE','BUDGET.UPDATE','BUDGET.VALIDATE','BUDGET.EXPORT')
ON CONFLICT DO NOTHING;

-- AUDITOR : lecture seule + export, jamais d'écriture.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'AUDITOR'
  AND p.code IN ('BUDGET.READ','BUDGET.EXPORT')
ON CONFLICT DO NOTHING;

-- VIEWER : lecture seule.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'VIEWER'
  AND p.code IN ('BUDGET.READ')
ON CONFLICT DO NOTHING;

COMMIT;
