-- =====================================================================
-- Seed additif — Étape 10 : permissions manquantes pour devis, et
-- compléments clients/fournisseurs/paiements. 14 permissions
-- existaient déjà (CUSTOMER.CREATE/READ/UPDATE, SUPPLIER.CREATE/READ/
-- UPDATE, INVOICE.CREATE/READ/UPDATE/VALIDATE/CANCEL, PAYMENT.CREATE/
-- READ/CANCEL) — non recréées. Convention MODULE.ACTION déjà établie.
-- Idempotent (ON CONFLICT).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'CUSTOMER.DISABLE', 'CUSTOMER', 'Désactiver un client'),
  (gen_random_uuid()::text, 'SUPPLIER.DISABLE', 'SUPPLIER', 'Désactiver un fournisseur'),
  (gen_random_uuid()::text, 'QUOTE.READ',       'QUOTE',    'Consulter les devis'),
  (gen_random_uuid()::text, 'QUOTE.CREATE',     'QUOTE',    'Créer un devis'),
  (gen_random_uuid()::text, 'QUOTE.UPDATE',     'QUOTE',    'Modifier un devis en brouillon'),
  (gen_random_uuid()::text, 'QUOTE.SEND',       'QUOTE',    'Envoyer un devis au client'),
  (gen_random_uuid()::text, 'QUOTE.ACCEPT',     'QUOTE',    'Marquer un devis comme accepté'),
  (gen_random_uuid()::text, 'QUOTE.REJECT',     'QUOTE',    'Marquer un devis comme refusé'),
  (gen_random_uuid()::text, 'QUOTE.CONVERT',    'QUOTE',    'Convertir un devis accepté en facture'),
  (gen_random_uuid()::text, 'PAYMENT.UPDATE',   'PAYMENT',  'Modifier un paiement (référence, notes)')
ON CONFLICT (code) DO NOTHING;

-- ADMIN / SUPER_ADMIN : tout.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND p.code IN ('CUSTOMER.DISABLE','SUPPLIER.DISABLE','QUOTE.READ','QUOTE.CREATE','QUOTE.UPDATE','QUOTE.SEND','QUOTE.ACCEPT','QUOTE.REJECT','QUOTE.CONVERT','PAYMENT.UPDATE')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT : cycle commercial complet (cohérent avec son accès déjà
-- large sur INVOICE/PAYMENT existant).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTANT'
  AND p.code IN ('CUSTOMER.DISABLE','SUPPLIER.DISABLE','QUOTE.READ','QUOTE.CREATE','QUOTE.UPDATE','QUOTE.SEND','QUOTE.ACCEPT','QUOTE.REJECT','QUOTE.CONVERT','PAYMENT.UPDATE')
ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : peut créer/consulter les devis, pas les
-- décisions engageantes (accept/reject/convert/disable) — cohérent
-- avec l'absence de ENTRY.VALIDATE et LETTERING.CLOSE pour ce rôle.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT'
  AND p.code IN ('QUOTE.READ','QUOTE.CREATE','QUOTE.UPDATE','QUOTE.SEND')
ON CONFLICT DO NOTHING;

-- DIRECTOR / AUDITOR / VIEWER : lecture seule sur les devis (cohérent
-- avec REPORT.READ/LETTERING.READ déjà accordés à ces rôles).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('DIRECTOR', 'AUDITOR', 'VIEWER')
  AND p.code = 'QUOTE.READ'
ON CONFLICT DO NOTHING;

COMMIT;
