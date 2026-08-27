-- =====================================================================
-- Étape 11 — Trésorerie (caisse, banques, rapprochement bancaire).
--
-- CashAccount, CashTransaction, BankAccount, BankTransaction,
-- BankReconciliation existaient déjà (schéma initial) et sont
-- réutilisés SANS recréation. Seuls les manques réels identifiés par
-- inventaire sont comblés ici :
--
-- 1) code sur cash_accounts/bank_accounts : champ explicitement requis
--    par le cahier des charges, absent du modèle existant. Unique par
--    entreprise, saisi par l'utilisateur (même convention que
--    Journal.code/Customer.code — pas de numérotation automatique).
-- 2) bank_accounts.name (libellé distinct de bank_name), swift_bic,
--    description : champs listés explicitement, absents.
-- 3) cash_accounts.description : idem.
-- 4) bank_transactions.source (BOOK | STATEMENT) : le modèle existant
--    ne distinguait pas un mouvement généré par l'entreprise (avec
--    écriture comptable liée) d'une ligne importée du relevé bancaire
--    (sans écriture, en attente de rapprochement) — pourtant
--    indispensable pour représenter un import bancaire sans le
--    confondre avec un mouvement déjà comptabilisé.
-- 5) Table bank_reconciliation_matches : table de jonction permettant
--    de pointer une ou plusieurs lignes de relevé (source=STATEMENT)
--    avec un ou plusieurs mouvements du livre (source=BOOK) au sein
--    d'une session de rapprochement — le modèle existant ne permettait
--    qu'un rattachement 1-N via bank_transactions.reconciliation_id,
--    insuffisant pour un pointage explicite ligne-à-ligne.
-- 6) bank_reconciliations.created_by_id, canceled_at, canceled_by_id :
--    traçabilité de création et annulation, absente du modèle initial.
-- =====================================================================

ALTER TABLE cash_accounts ADD COLUMN code TEXT;
ALTER TABLE cash_accounts ADD COLUMN description TEXT;
UPDATE cash_accounts SET code = 'CAISSE-' || substr(id, 1, 8) WHERE code IS NULL;
ALTER TABLE cash_accounts ALTER COLUMN code SET NOT NULL;
ALTER TABLE cash_accounts ADD CONSTRAINT cash_accounts_company_id_code_key UNIQUE (company_id, code);

ALTER TABLE bank_accounts ADD COLUMN code TEXT;
ALTER TABLE bank_accounts ADD COLUMN name TEXT;
ALTER TABLE bank_accounts ADD COLUMN swift_bic TEXT;
ALTER TABLE bank_accounts ADD COLUMN description TEXT;
UPDATE bank_accounts SET code = 'BANQUE-' || substr(id, 1, 8) WHERE code IS NULL;
UPDATE bank_accounts SET name = bank_name WHERE name IS NULL;
ALTER TABLE bank_accounts ALTER COLUMN code SET NOT NULL;
ALTER TABLE bank_accounts ALTER COLUMN name SET NOT NULL;
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_company_id_code_key UNIQUE (company_id, code);

CREATE TYPE "BankTransactionSource" AS ENUM ('BOOK', 'STATEMENT');
ALTER TABLE bank_transactions ADD COLUMN source "BankTransactionSource" NOT NULL DEFAULT 'BOOK';
-- Une ligne importée (STATEMENT) n'a par définition pas encore
-- d'écriture comptable liée au moment de l'import — contrainte
-- documentaire seulement (pas de CHECK ici pour rester compatible
-- avec un futur pointage qui pourrait générer une écriture).

ALTER TABLE bank_reconciliations ADD COLUMN created_by_id TEXT;
ALTER TABLE bank_reconciliations ADD COLUMN canceled_at TIMESTAMP(3);
ALTER TABLE bank_reconciliations ADD COLUMN canceled_by_id TEXT;
ALTER TABLE bank_reconciliations ADD CONSTRAINT bank_reconciliations_created_by_id_fkey
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE bank_reconciliations ADD CONSTRAINT bank_reconciliations_canceled_by_id_fkey
  FOREIGN KEY (canceled_by_id) REFERENCES users(id) ON DELETE RESTRICT;

CREATE TABLE bank_reconciliation_matches (
  id                       TEXT PRIMARY KEY,
  reconciliation_id        TEXT NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  company_id               TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  statement_transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  book_transaction_id      TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  created_at               TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT bank_reconciliation_matches_unique_pair UNIQUE (statement_transaction_id, book_transaction_id)
);
CREATE INDEX bank_reconciliation_matches_reconciliation_id_idx ON bank_reconciliation_matches(reconciliation_id);
CREATE INDEX bank_reconciliation_matches_company_id_idx ON bank_reconciliation_matches(company_id);
CREATE INDEX bank_reconciliation_matches_statement_idx ON bank_reconciliation_matches(statement_transaction_id);
CREATE INDEX bank_reconciliation_matches_book_idx ON bank_reconciliation_matches(book_transaction_id);

CREATE INDEX bank_transactions_bank_account_id_source_idx ON bank_transactions(bank_account_id, source);
