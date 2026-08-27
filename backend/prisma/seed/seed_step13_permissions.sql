-- =====================================================================
-- Seed additif — Étape 13 : permissions taxes/déclarations fiscales.
-- Aucune permission TAX.* n'existait avant cette étape (inventaire
-- initial). Convention MODULE.ACTION déjà établie. Idempotent
-- (ON CONFLICT).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'TAX.READ',       'TAX', 'Consulter les taxes, la configuration fiscale et les déclarations'),
  (gen_random_uuid()::text, 'TAX.CREATE',     'TAX', 'Créer une taxe ou une déclaration fiscale'),
  (gen_random_uuid()::text, 'TAX.UPDATE',     'TAX', 'Modifier une taxe, sa configuration ou une déclaration en brouillon'),
  (gen_random_uuid()::text, 'TAX.VALIDATE',   'TAX', 'Valider une déclaration fiscale (génère l''écriture de TVA à décaisser)'),
  (gen_random_uuid()::text, 'TAX.DECLARE',    'TAX', 'Soumettre une déclaration fiscale'),
  (gen_random_uuid()::text, 'TAX.PAY',        'TAX', 'Enregistrer le paiement d''une déclaration fiscale'),
  (gen_random_uuid()::text, 'TAX.EXPORT',     'TAX', 'Exporter le registre des déclarations fiscales')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code IN ('TAX.READ','TAX.CREATE','TAX.UPDATE','TAX.VALIDATE','TAX.DECLARE','TAX.PAY','TAX.EXPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : cycle fiscal complet (cohérent avec sa gestion comptable
-- complète déjà accordée sur les autres modules).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('TAX.READ','TAX.CREATE','TAX.UPDATE','TAX.VALIDATE','TAX.DECLARE','TAX.PAY','TAX.EXPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : peut créer/mettre à jour une déclaration en
-- brouillon, jamais la valider ni déclarer/payer — cohérent avec
-- l'absence de ENTRY.VALIDATE / ASSET.DEPRECIATE pour ce rôle.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT'
  AND p.code IN ('TAX.READ','TAX.CREATE','TAX.UPDATE')
ON CONFLICT DO NOTHING;

-- DIRECTOR : lecture large + export, cohérent avec son accès
-- pilotage/reporting déjà accordé ailleurs.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'DIRECTOR'
  AND p.code IN ('TAX.READ','TAX.EXPORT')
ON CONFLICT DO NOTHING;

-- AUDITOR : lecture seule partout + export, jamais d'écriture — règle
-- constante du projet pour ce rôle.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'AUDITOR'
  AND p.code IN ('TAX.READ','TAX.EXPORT')
ON CONFLICT DO NOTHING;

-- VIEWER : lecture seule, périmètre plus restreint que AUDITOR.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'VIEWER'
  AND p.code IN ('TAX.READ')
ON CONFLICT DO NOTHING;

COMMIT;
