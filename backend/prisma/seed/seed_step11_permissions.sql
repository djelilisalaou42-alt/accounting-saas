-- =====================================================================
-- Seed additif — Étape 11 : permissions trésorerie manquantes. 6
-- permissions existaient déjà (BANK.CREATE/READ/RECONCILE,
-- CASH.CLOSE/CREATE/READ) — non recréées. CASH.CLOSE est réutilisée
-- comme permission de désactivation/réactivation d'une caisse (aucune
-- CASH.DISABLE distincte créée). BANK.RECONCILE réutilisée comme
-- permission d'ouverture d'une session de rapprochement (mappée à
-- RECONCILIATION.CREATE côté contrôleur) — les autres actions de
-- rapprochement (lecture, clôture, annulation, import) nécessitent
-- des permissions dédiées, absentes.
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'CASH.UPDATE',           'CASH',           'Modifier une caisse'),
  (gen_random_uuid()::text, 'CASH.MOVEMENT.CREATE',  'CASH',           'Créer un mouvement de caisse'),
  (gen_random_uuid()::text, 'CASH.MOVEMENT.READ',    'CASH',           'Consulter les mouvements de caisse'),
  (gen_random_uuid()::text, 'BANK.UPDATE',           'BANK',           'Modifier un compte bancaire'),
  (gen_random_uuid()::text, 'BANK.DISABLE',          'BANK',           'Désactiver/réactiver un compte bancaire'),
  (gen_random_uuid()::text, 'BANK.MOVEMENT.CREATE',  'BANK',           'Créer un mouvement bancaire'),
  (gen_random_uuid()::text, 'BANK.MOVEMENT.READ',    'BANK',           'Consulter les mouvements bancaires'),
  (gen_random_uuid()::text, 'RECONCILIATION.READ',    'RECONCILIATION', 'Consulter les rapprochements bancaires'),
  (gen_random_uuid()::text, 'RECONCILIATION.COMPLETE','RECONCILIATION', 'Clôturer un rapprochement bancaire'),
  (gen_random_uuid()::text, 'RECONCILIATION.CANCEL',  'RECONCILIATION', 'Annuler un rapprochement bancaire'),
  (gen_random_uuid()::text, 'RECONCILIATION.IMPORT',  'RECONCILIATION', 'Importer un relevé bancaire CSV')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code IN ('CASH.UPDATE','CASH.MOVEMENT.CREATE','CASH.MOVEMENT.READ','BANK.UPDATE','BANK.DISABLE','BANK.MOVEMENT.CREATE','BANK.MOVEMENT.READ','RECONCILIATION.READ','RECONCILIATION.COMPLETE','RECONCILIATION.CANCEL','RECONCILIATION.IMPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : cycle trésorerie complet (cohérent avec son accès déjà
-- large sur CASH.CREATE/READ, BANK.CREATE/READ/RECONCILE existants).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('CASH.UPDATE','CASH.MOVEMENT.CREATE','CASH.MOVEMENT.READ','BANK.UPDATE','BANK.DISABLE','BANK.MOVEMENT.CREATE','BANK.MOVEMENT.READ','RECONCILIATION.READ','RECONCILIATION.COMPLETE','RECONCILIATION.CANCEL','RECONCILIATION.IMPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : peut créer des mouvements et consulter, pas
-- clôturer/annuler un rapprochement ni gérer les comptes eux-mêmes —
-- cohérent avec l'absence de ENTRY.VALIDATE/LETTERING.CLOSE pour ce rôle.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT'
  AND p.code IN ('CASH.MOVEMENT.CREATE','CASH.MOVEMENT.READ','BANK.MOVEMENT.CREATE','BANK.MOVEMENT.READ','RECONCILIATION.READ')
ON CONFLICT DO NOTHING;

-- DIRECTOR / AUDITOR / VIEWER : lecture seule (cohérent avec
-- CASH.READ/BANK.READ déjà accordés à ces rôles).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('DIRECTOR', 'AUDITOR', 'VIEWER')
  AND p.code IN ('CASH.MOVEMENT.READ','BANK.MOVEMENT.READ','RECONCILIATION.READ')
ON CONFLICT DO NOTHING;

COMMIT;
