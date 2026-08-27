-- =====================================================================
-- Seed additif — Étape 7 : permissions manquantes pour les journaux et
-- écritures. La plupart existaient déjà depuis le seed de l'Étape 5
-- (ENTRY.CREATE/READ/UPDATE/VALIDATE/REVERSE, JOURNAL.CREATE/READ/UPDATE)
-- — seules ENTRY.DELETE, JOURNAL.DISABLE, JOURNAL.ENABLE manquaient.
-- Idempotent (ON CONFLICT), respecte le nommage déjà en place (ENTRY.*,
-- pas ACCOUNTING_ENTRY.* — voir README).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'ENTRY.DELETE',    'ENTRY',   'Supprimer une écriture en brouillon'),
  (gen_random_uuid()::text, 'JOURNAL.DISABLE', 'JOURNAL', 'Désactiver un journal'),
  (gen_random_uuid()::text, 'JOURNAL.ENABLE',  'JOURNAL', 'Réactiver un journal')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code IN ('ENTRY.DELETE', 'JOURNAL.DISABLE', 'JOURNAL.ENABLE')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : gère les journaux et peut supprimer ses brouillons.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('ENTRY.DELETE', 'JOURNAL.DISABLE', 'JOURNAL.ENABLE')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : peut supprimer ses propres brouillons, mais ne
-- gère pas les journaux (cohérent avec l'absence de JOURNAL.CREATE/UPDATE
-- pour ce rôle depuis l'Étape 5).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT'
  AND p.code = 'ENTRY.DELETE'
ON CONFLICT DO NOTHING;

COMMIT;
