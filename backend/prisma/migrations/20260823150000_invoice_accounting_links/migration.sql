-- =====================================================================
-- Étape 10 (suite) — Liaison factures/lignes de facture vers les
-- comptes réellement configurés dans le référentiel comptable de
-- l'entreprise. Sans ces colonnes, la génération d'écriture (Phase 7)
-- ne pourrait pas savoir quel compte de produit/charge créditer/
-- débiter sans coder un numéro en dur — ce que le cahier des charges
-- interdit explicitement.
--
-- - invoice_items.account_id : compte de produit (facture de vente) ou
--   de charge (facture d'achat) pour cette ligne — choisi par
--   l'utilisateur dans son plan comptable réel, jamais déduit.
-- - invoices.tax_account_id : compte de TVA collectée (vente) ou
--   récupérable (achat) pour l'ensemble de la facture — un seul compte
--   TVA par facture plutôt que par ligne, cohérent avec la pratique
--   courante (une facture n'a généralement qu'un seul taux de TVA
--   dominant comptabilisé sur un compte dédié).
-- =====================================================================

ALTER TABLE invoice_items ADD COLUMN account_id TEXT;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE invoices ADD COLUMN tax_account_id TEXT;
ALTER TABLE invoices ADD CONSTRAINT invoices_tax_account_id_fkey
  FOREIGN KEY (tax_account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
