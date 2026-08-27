-- =====================================================================
-- Seed additif — Étape 16 : permissions pièces jointes. Aucune
-- permission ATTACHMENT.* n'existait avant cette étape (contrairement
-- à TAX.*/BUDGET.* qui avaient des codes placeholder dès l'Étape 5,
-- ATTACHMENT n'en avait aucun — vérifié). Convention MODULE.ACTION
-- déjà établie. Idempotent (ON CONFLICT).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'ATTACHMENT.READ',   'ATTACHMENT', 'Consulter et télécharger les pièces jointes'),
  (gen_random_uuid()::text, 'ATTACHMENT.CREATE', 'ATTACHMENT', 'Téléverser une pièce jointe'),
  (gen_random_uuid()::text, 'ATTACHMENT.DELETE', 'ATTACHMENT', 'Supprimer une pièce jointe'),
  (gen_random_uuid()::text, 'ATTACHMENT.EXPORT', 'ATTACHMENT', 'Exporter le registre des pièces jointes')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code IN ('ATTACHMENT.READ','ATTACHMENT.CREATE','ATTACHMENT.DELETE','ATTACHMENT.EXPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : gestion complète (cohérent avec sa gestion documentaire
-- complète déjà accordée sur les autres modules).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('ATTACHMENT.READ','ATTACHMENT.CREATE','ATTACHMENT.DELETE','ATTACHMENT.EXPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : peut téléverser/consulter, jamais supprimer —
-- cohérent avec ses permissions restreintes sur les autres modules
-- (jamais de suppression/validation définitive accordée à ce rôle).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT'
  AND p.code IN ('ATTACHMENT.READ','ATTACHMENT.CREATE')
ON CONFLICT DO NOTHING;

-- DIRECTOR : lecture + export, cohérent avec son accès pilotage/reporting.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'DIRECTOR'
  AND p.code IN ('ATTACHMENT.READ','ATTACHMENT.EXPORT')
ON CONFLICT DO NOTHING;

-- AUDITOR : lecture seule + export, jamais d'écriture — règle
-- constante du projet pour ce rôle.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'AUDITOR'
  AND p.code IN ('ATTACHMENT.READ','ATTACHMENT.EXPORT')
ON CONFLICT DO NOTHING;

-- VIEWER : lecture seule.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'VIEWER'
  AND p.code IN ('ATTACHMENT.READ')
ON CONFLICT DO NOTHING;

COMMIT;
