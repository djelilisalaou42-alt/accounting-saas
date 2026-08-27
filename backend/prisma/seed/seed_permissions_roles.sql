-- =====================================================================
-- Seed — Permissions, rôles système, matrice de correspondance
-- (Étape 5). Données de référence, pas des données métier fictives :
-- ce script peut/doit être rejoué en production (idempotent via
-- ON CONFLICT). Aucune donnée personnelle.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Permissions (format MODULE.ACTION)
-- ---------------------------------------------------------------------
INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'COMPANY.READ',    'COMPANY',  'Consulter les informations de l''entreprise'),
  (gen_random_uuid()::text, 'COMPANY.UPDATE',  'COMPANY',  'Modifier les informations de l''entreprise'),
  (gen_random_uuid()::text, 'COMPANY.DELETE',  'COMPANY',  'Archiver/supprimer l''entreprise'),

  (gen_random_uuid()::text, 'USER.READ',       'USER',     'Voir les membres de l''entreprise'),
  (gen_random_uuid()::text, 'USER.CREATE',     'USER',     'Inviter un membre'),
  (gen_random_uuid()::text, 'USER.UPDATE',     'USER',     'Modifier le rôle d''un membre'),
  (gen_random_uuid()::text, 'USER.DISABLE',    'USER',     'Désactiver/réactiver/retirer un membre'),

  (gen_random_uuid()::text, 'ACCOUNT.READ',    'ACCOUNT',  'Consulter le plan comptable'),
  (gen_random_uuid()::text, 'ACCOUNT.CREATE',  'ACCOUNT',  'Créer un compte'),
  (gen_random_uuid()::text, 'ACCOUNT.UPDATE',  'ACCOUNT',  'Modifier un compte'),

  (gen_random_uuid()::text, 'JOURNAL.READ',    'JOURNAL',  'Consulter les journaux'),
  (gen_random_uuid()::text, 'JOURNAL.CREATE',  'JOURNAL',  'Créer un journal'),
  (gen_random_uuid()::text, 'JOURNAL.UPDATE',  'JOURNAL',  'Modifier un journal'),

  (gen_random_uuid()::text, 'ENTRY.READ',      'ENTRY',    'Consulter les écritures'),
  (gen_random_uuid()::text, 'ENTRY.CREATE',    'ENTRY',    'Saisir une écriture'),
  (gen_random_uuid()::text, 'ENTRY.UPDATE',    'ENTRY',    'Modifier une écriture brouillon'),
  (gen_random_uuid()::text, 'ENTRY.VALIDATE',  'ENTRY',    'Valider une écriture'),
  (gen_random_uuid()::text, 'ENTRY.REVERSE',   'ENTRY',    'Contrepasser une écriture'),

  (gen_random_uuid()::text, 'CUSTOMER.READ',   'CUSTOMER', 'Consulter les clients'),
  (gen_random_uuid()::text, 'CUSTOMER.CREATE', 'CUSTOMER', 'Créer un client'),
  (gen_random_uuid()::text, 'CUSTOMER.UPDATE', 'CUSTOMER', 'Modifier un client'),

  (gen_random_uuid()::text, 'SUPPLIER.READ',   'SUPPLIER', 'Consulter les fournisseurs'),
  (gen_random_uuid()::text, 'SUPPLIER.CREATE', 'SUPPLIER', 'Créer un fournisseur'),
  (gen_random_uuid()::text, 'SUPPLIER.UPDATE', 'SUPPLIER', 'Modifier un fournisseur'),

  (gen_random_uuid()::text, 'INVOICE.READ',    'INVOICE',  'Consulter les factures'),
  (gen_random_uuid()::text, 'INVOICE.CREATE',  'INVOICE',  'Créer une facture'),
  (gen_random_uuid()::text, 'INVOICE.UPDATE',  'INVOICE',  'Modifier une facture brouillon'),
  (gen_random_uuid()::text, 'INVOICE.VALIDATE','INVOICE',  'Valider une facture'),
  (gen_random_uuid()::text, 'INVOICE.CANCEL',  'INVOICE',  'Annuler une facture'),

  (gen_random_uuid()::text, 'PAYMENT.READ',    'PAYMENT',  'Consulter les paiements'),
  (gen_random_uuid()::text, 'PAYMENT.CREATE',  'PAYMENT',  'Enregistrer un paiement'),
  (gen_random_uuid()::text, 'PAYMENT.CANCEL',  'PAYMENT',  'Annuler un paiement'),

  (gen_random_uuid()::text, 'CASH.READ',       'CASH',     'Consulter la caisse'),
  (gen_random_uuid()::text, 'CASH.CREATE',     'CASH',     'Enregistrer un mouvement de caisse'),
  (gen_random_uuid()::text, 'CASH.CLOSE',      'CASH',     'Clôturer une caisse'),

  (gen_random_uuid()::text, 'BANK.READ',       'BANK',     'Consulter les comptes bancaires'),
  (gen_random_uuid()::text, 'BANK.CREATE',     'BANK',     'Enregistrer un mouvement bancaire'),
  (gen_random_uuid()::text, 'BANK.RECONCILE',  'BANK',     'Effectuer un rapprochement bancaire'),

  (gen_random_uuid()::text, 'REPORT.READ',     'REPORT',   'Consulter les rapports'),
  (gen_random_uuid()::text, 'REPORT.EXPORT',   'REPORT',   'Exporter un rapport'),

  (gen_random_uuid()::text, 'TAX.READ',        'TAX',      'Consulter la fiscalité'),
  (gen_random_uuid()::text, 'TAX.CREATE',      'TAX',      'Créer une déclaration/un taux'),
  (gen_random_uuid()::text, 'TAX.UPDATE',      'TAX',      'Modifier une déclaration/un taux'),

  (gen_random_uuid()::text, 'BUDGET.READ',     'BUDGET',   'Consulter les budgets'),
  (gen_random_uuid()::text, 'BUDGET.CREATE',   'BUDGET',   'Créer un budget'),
  (gen_random_uuid()::text, 'BUDGET.UPDATE',   'BUDGET',   'Modifier un budget'),

  (gen_random_uuid()::text, 'AUDIT.READ',      'AUDIT',    'Consulter le journal d''audit')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Rôles système globaux (company_id = null, réutilisables par toute
-- entreprise — voir README pour la justification de ce choix).
-- ---------------------------------------------------------------------
INSERT INTO roles (id, company_id, name, description, is_system, created_at, updated_at) VALUES
  ('r0000000-0000-0000-0000-000000000001', NULL, 'SUPER_ADMIN',          'Administration technique globale du SaaS (hors périmètre entreprise — voir users.is_super_admin)', true, now(), now()),
  ('r0000000-0000-0000-0000-000000000002', NULL, 'ADMIN',                'Administration complète d''une entreprise', true, now(), now()),
  ('r0000000-0000-0000-0000-000000000003', NULL, 'DIRECTOR',             'Accès aux données et rapports de l''entreprise', true, now(), now()),
  ('r0000000-0000-0000-0000-000000000004', NULL, 'ACCOUNTANT',           'Gestion comptable complète', true, now(), now()),
  ('r0000000-0000-0000-0000-000000000005', NULL, 'ACCOUNTING_ASSISTANT', 'Saisie et consultation selon permissions', true, now(), now()),
  ('r0000000-0000-0000-0000-000000000006', NULL, 'AUDITOR',              'Consultation et contrôle sans modification des données comptables', true, now(), now()),
  ('r0000000-0000-0000-0000-000000000007', NULL, 'VIEWER',               'Consultation uniquement', true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Matrice rôle -> permissions
-- ---------------------------------------------------------------------

-- SUPER_ADMIN : toutes les permissions (valeur surtout documentaire —
-- l'accès plateforme réel passe par users.is_super_admin, pas par ce
-- rôle, qui n'est de toute façon jamais attaché via UserCompany).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000001', id FROM permissions
ON CONFLICT DO NOTHING;

-- ADMIN : toutes les permissions, au sein de son entreprise.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000002', id FROM permissions
ON CONFLICT DO NOTHING;

-- DIRECTOR : lecture large + pilotage budgétaire + export.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000003', id FROM permissions
WHERE code IN (
  'COMPANY.READ','USER.READ','ACCOUNT.READ','JOURNAL.READ','ENTRY.READ',
  'CUSTOMER.READ','SUPPLIER.READ','INVOICE.READ','PAYMENT.READ','CASH.READ',
  'BANK.READ','REPORT.READ','REPORT.EXPORT','TAX.READ',
  'BUDGET.READ','BUDGET.CREATE','BUDGET.UPDATE','AUDIT.READ'
) ON CONFLICT DO NOTHING;

-- ACCOUNTANT : gestion comptable complète, pas de gestion des membres
-- ni des paramètres d'entreprise.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000004', id FROM permissions
WHERE code IN (
  'COMPANY.READ',
  'ACCOUNT.READ','ACCOUNT.CREATE','ACCOUNT.UPDATE',
  'JOURNAL.READ','JOURNAL.CREATE','JOURNAL.UPDATE',
  'ENTRY.READ','ENTRY.CREATE','ENTRY.UPDATE','ENTRY.VALIDATE','ENTRY.REVERSE',
  'CUSTOMER.READ','CUSTOMER.CREATE','CUSTOMER.UPDATE',
  'SUPPLIER.READ','SUPPLIER.CREATE','SUPPLIER.UPDATE',
  'INVOICE.READ','INVOICE.CREATE','INVOICE.UPDATE','INVOICE.VALIDATE','INVOICE.CANCEL',
  'PAYMENT.READ','PAYMENT.CREATE','PAYMENT.CANCEL',
  'CASH.READ','CASH.CREATE','CASH.CLOSE',
  'BANK.READ','BANK.CREATE','BANK.RECONCILE',
  'REPORT.READ','REPORT.EXPORT',
  'TAX.READ','TAX.CREATE','TAX.UPDATE',
  'BUDGET.READ','AUDIT.READ'
) ON CONFLICT DO NOTHING;

-- ACCOUNTING_ASSISTANT : saisie et consultation, JAMAIS de validation
-- ni de contrepassation ni d'annulation (c'est précisément ce qui
-- distingue ce rôle du comptable — testé explicitement, voir tests).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000005', id FROM permissions
WHERE code IN (
  'ACCOUNT.READ','JOURNAL.READ',
  'ENTRY.READ','ENTRY.CREATE',
  'CUSTOMER.READ','CUSTOMER.CREATE',
  'SUPPLIER.READ','SUPPLIER.CREATE',
  'INVOICE.READ','INVOICE.CREATE',
  'PAYMENT.READ','PAYMENT.CREATE',
  'CASH.READ','BANK.READ','REPORT.READ'
) ON CONFLICT DO NOTHING;

-- AUDITOR : lecture seule partout + audit + export, jamais d'écriture.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000006', id FROM permissions
WHERE code IN (
  'COMPANY.READ','USER.READ','ACCOUNT.READ','JOURNAL.READ','ENTRY.READ',
  'CUSTOMER.READ','SUPPLIER.READ','INVOICE.READ','PAYMENT.READ','CASH.READ',
  'BANK.READ','REPORT.READ','REPORT.EXPORT','TAX.READ','BUDGET.READ','AUDIT.READ'
) ON CONFLICT DO NOTHING;

-- VIEWER : lecture seule, périmètre plus restreint que AUDITOR (pas
-- d'accès aux membres ni à l'audit ni à l'export).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r0000000-0000-0000-0000-000000000007', id FROM permissions
WHERE code IN (
  'COMPANY.READ','ACCOUNT.READ','JOURNAL.READ','ENTRY.READ',
  'CUSTOMER.READ','SUPPLIER.READ','INVOICE.READ','PAYMENT.READ',
  'CASH.READ','BANK.READ','REPORT.READ','TAX.READ','BUDGET.READ'
) ON CONFLICT DO NOTHING;

COMMIT;
