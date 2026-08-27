-- =====================================================================
-- Seed additif — Étape 12 : permissions immobilisations/amortissements.
-- Aucune permission ASSET.* n'existait avant cette étape (inventaire
-- initial). ASSET.CREATE/READ/UPDATE/DISABLE couvrent aussi la gestion
-- des catégories d'immobilisations (aucune permission CATEGORY.*
-- distincte créée — même économie de permissions que CASH.CLOSE
-- réutilisée pour l'activation/désactivation d'une caisse, Étape 11).
-- Convention MODULE.ACTION déjà établie. Idempotent (ON CONFLICT).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'ASSET.READ',       'ASSET', 'Consulter les immobilisations et catégories'),
  (gen_random_uuid()::text, 'ASSET.CREATE',     'ASSET', 'Créer une immobilisation ou une catégorie'),
  (gen_random_uuid()::text, 'ASSET.UPDATE',     'ASSET', 'Modifier une immobilisation ou une catégorie'),
  (gen_random_uuid()::text, 'ASSET.DISABLE',    'ASSET', 'Désactiver/réactiver une catégorie d''immobilisation'),
  (gen_random_uuid()::text, 'ASSET.SERVICE',    'ASSET', 'Mettre en service une immobilisation'),
  (gen_random_uuid()::text, 'ASSET.DEPRECIATE', 'ASSET', 'Générer une dotation aux amortissements'),
  (gen_random_uuid()::text, 'ASSET.DISPOSAL',   'ASSET', 'Enregistrer la cession/sortie d''une immobilisation'),
  (gen_random_uuid()::text, 'ASSET.EXPORT',     'ASSET', 'Exporter le registre des immobilisations')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code IN ('ASSET.READ','ASSET.CREATE','ASSET.UPDATE','ASSET.DISABLE','ASSET.SERVICE','ASSET.DEPRECIATE','ASSET.DISPOSAL','ASSET.EXPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : cycle immobilisations complet (cohérent avec sa gestion
-- comptable complète déjà accordée sur les autres modules — trésorerie,
-- lettrage, factures).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('ASSET.READ','ASSET.CREATE','ASSET.UPDATE','ASSET.DISABLE','ASSET.SERVICE','ASSET.DEPRECIATE','ASSET.DISPOSAL','ASSET.EXPORT')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : peut créer/mettre à jour des fiches et les
-- mettre en service, mais jamais générer de dotation, céder une
-- immobilisation ni gérer les catégories — cohérent avec l'absence de
-- ENTRY.VALIDATE et de RECONCILIATION.COMPLETE pour ce rôle (Étapes 7/11).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT'
  AND p.code IN ('ASSET.READ','ASSET.CREATE','ASSET.UPDATE','ASSET.SERVICE')
ON CONFLICT DO NOTHING;

-- DIRECTOR : lecture large + export, cohérent avec son accès pilotage/
-- reporting déjà accordé ailleurs (budgets, rapports).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'DIRECTOR'
  AND p.code IN ('ASSET.READ','ASSET.EXPORT')
ON CONFLICT DO NOTHING;

-- AUDITOR : lecture seule partout + export, jamais d'écriture — règle
-- constante du projet pour ce rôle (Étape 11).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'AUDITOR'
  AND p.code IN ('ASSET.READ','ASSET.EXPORT')
ON CONFLICT DO NOTHING;

-- VIEWER : lecture seule, périmètre plus restreint que AUDITOR (pas
-- d'export) — cohérent avec la règle déjà appliquée aux autres modules.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'VIEWER'
  AND p.code IN ('ASSET.READ')
ON CONFLICT DO NOTHING;

COMMIT;
