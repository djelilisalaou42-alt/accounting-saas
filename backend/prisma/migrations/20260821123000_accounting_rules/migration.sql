-- =====================================================================
-- Migration: 20260821123000_accounting_rules
--
-- Règles comptables non exprimables nativement en Prisma :
--   A. Équilibre débit = crédit obligatoire à la validation
--   B. Immuabilité des écritures validées / contrepassées
--   C. Anti-chevauchement des exercices + interdiction de saisie en
--      exercice clôturé
--   D. Intégrité du lettrage (somme des lignes lettrées = 0)
--   E. Numérotation atomique (fonction utilisée par NumberingSequence)
--   F. Dénormalisation automatique de company_id sur les tables de détail
--      (garantit la cohérence du filet de sécurité multi-tenant posé en
--      Étape 2, même en cas d'INSERT direct en base)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist; -- EXCLUDE USING gist sur (égalité + chevauchement)

-- =====================================================================
-- A. ÉQUILIBRE DÉBIT = CRÉDIT
--
-- Fonctionnement : déclenché AVANT tout INSERT/UPDATE sur
-- accounting_entries. Ne s'active QUE lorsque la ligne passe (ou
-- arrive) au statut VALIDATED alors qu'elle ne l'était pas déjà
-- (DRAFT -> VALIDATED). Il recalcule la somme des débits et des
-- crédits directement depuis accounting_entry_lines (jamais depuis les
-- colonnes total_debit/total_credit, qui ne sont qu'un cache) et refuse
-- la validation si les deux sommes diffèrent, si l'écriture est vide,
-- ou si elle a moins de deux lignes. En cas de succès, il réécrit
-- total_debit/total_credit avec les valeurs réelles calculées, pour que
-- le cache ne puisse jamais diverger de la réalité.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_check_entry_balance() RETURNS TRIGGER AS $$
DECLARE
  v_total_debit  DECIMAL(18,2);
  v_total_credit DECIMAL(18,2);
  v_line_count   INTEGER;
BEGIN
  IF NEW.status = 'VALIDATED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'VALIDATED') THEN

    SELECT
      COALESCE(SUM(CASE WHEN side = 'DEBIT'  THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount ELSE 0 END), 0),
      COUNT(*)
    INTO v_total_debit, v_total_credit, v_line_count
    FROM accounting_entry_lines
    WHERE entry_id = NEW.id;

    IF v_line_count < 2 THEN
      RAISE EXCEPTION 'Écriture %: une écriture validée doit comporter au moins deux lignes (trouvé: %)', NEW.id, v_line_count;
    END IF;

    IF v_total_debit = 0 AND v_total_credit = 0 THEN
      RAISE EXCEPTION 'Écriture %: impossible de valider une écriture dont tous les montants sont nuls', NEW.id;
    END IF;

    IF v_total_debit <> v_total_credit THEN
      RAISE EXCEPTION 'Écriture %: déséquilibrée (débit=% / crédit=%) — validation refusée', NEW.id, v_total_debit, v_total_credit;
    END IF;

    NEW.total_debit  := v_total_debit;
    NEW.total_credit := v_total_credit;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_a_check_entry_balance
  BEFORE INSERT OR UPDATE ON accounting_entries
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_entry_balance();

-- =====================================================================
-- B. IMMUABILITÉ DES ÉCRITURES VALIDÉES / CONTREPASSÉES
--
-- Deux triggers :
--
-- 1) Sur accounting_entries : une fois status = VALIDATED, seule la
--    transition VALIDATED -> REVERSED est autorisée (contrepassation),
--    et uniquement sur la colonne status elle-même — journal, période,
--    date, libellé, numéro et totaux ne peuvent plus bouger. Une fois
--    status = REVERSED, plus AUCUNE modification n'est permise. La
--    suppression (DELETE) est bloquée dès que le statut n'est plus
--    DRAFT : seules les écritures encore en brouillon peuvent être
--    supprimées physiquement.
--
-- 2) Sur accounting_entry_lines : toute tentative d'UPDATE ou de DELETE
--    sur une ligne dont l'écriture parente est VALIDATED (ou REVERSED)
--    est rejetée — la seule façon de corriger une écriture validée est
--    la contrepassation (nouvelle écriture), jamais l'édition directe
--    de ses lignes.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_protect_validated_entries() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Écriture %: suppression interdite (statut %) — seule une écriture en brouillon peut être supprimée. Utilisez la contrepassation.', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'Écriture %: une écriture contrepassée est définitivement immuable.', OLD.id;
  END IF;

  IF OLD.status = 'VALIDATED' THEN
    IF NEW.status NOT IN ('VALIDATED', 'REVERSED') THEN
      RAISE EXCEPTION 'Écriture %: transition de statut interdite (% -> %)', OLD.id, OLD.status, NEW.status;
    END IF;
    IF NEW.entry_date   IS DISTINCT FROM OLD.entry_date
       OR NEW.label        IS DISTINCT FROM OLD.label
       OR NEW.reference    IS DISTINCT FROM OLD.reference
       OR NEW.journal_id   IS DISTINCT FROM OLD.journal_id
       OR NEW.period_id    IS DISTINCT FROM OLD.period_id
       OR NEW.entry_number IS DISTINCT FROM OLD.entry_number
       OR NEW.total_debit  IS DISTINCT FROM OLD.total_debit
       OR NEW.total_credit IS DISTINCT FROM OLD.total_credit THEN
      RAISE EXCEPTION 'Écriture %: une écriture validée est immuable — seul son statut peut évoluer (contrepassation).', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_b_protect_validated_entries
  BEFORE UPDATE OR DELETE ON accounting_entries
  FOR EACH ROW
  EXECUTE FUNCTION fn_protect_validated_entries();

CREATE OR REPLACE FUNCTION fn_protect_validated_entry_lines() RETURNS TRIGGER AS $$
DECLARE
  v_status "EntryStatus";
BEGIN
  SELECT status INTO v_status FROM accounting_entries WHERE id = COALESCE(OLD.entry_id, NEW.entry_id);

  IF v_status IN ('VALIDATED', 'REVERSED') THEN
    RAISE EXCEPTION 'Ligne d''écriture (entry_id=%): modification/suppression interdite — l''écriture parente est %.', COALESCE(OLD.entry_id, NEW.entry_id), v_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_b_protect_validated_entry_lines
  BEFORE UPDATE OR DELETE ON accounting_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_protect_validated_entry_lines();

-- =====================================================================
-- C. EXERCICES COMPTABLES
--
-- C.1 — Anti-chevauchement : une colonne générée `period_range`
-- (daterange calculée depuis start_date/end_date) porte une contrainte
-- EXCLUDE PostgreSQL qui interdit, pour une même entreprise, deux
-- périodes dont les intervalles de dates se recouvrent — y compris
-- partiellement. Nécessite l'extension btree_gist (activée plus haut)
-- pour pouvoir combiner une égalité (company_id) et un chevauchement
-- (period_range) dans une même contrainte d'exclusion.
--
-- C.2 — Interdiction de saisie en exercice clôturé : trigger qui
-- vérifie le statut de l'exercice cible uniquement lorsque c'est
-- pertinent (création, déplacement de date/exercice, ou passage au
-- statut VALIDATED) — PAS lors d'une simple contrepassation
-- (VALIDATED -> REVERSED), qui doit précisément rester possible même
-- si l'exercice d'origine est désormais clôturé : c'est le mécanisme
-- normal de correction d'un exercice déjà clos.
-- =====================================================================

ALTER TABLE accounting_periods
  ADD COLUMN period_range daterange
  GENERATED ALWAYS AS (daterange(start_date::date, end_date::date, '[]')) STORED;

ALTER TABLE accounting_periods
  ADD CONSTRAINT excl_accounting_periods_no_overlap
  EXCLUDE USING gist (company_id WITH =, period_range WITH &&);

CREATE OR REPLACE FUNCTION fn_prevent_entry_in_closed_period() RETURNS TRIGGER AS $$
DECLARE
  v_period_status "PeriodStatus";
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.period_id  IS DISTINCT FROM OLD.period_id
     OR NEW.entry_date IS DISTINCT FROM OLD.entry_date
     OR (NEW.status = 'VALIDATED' AND OLD.status IS DISTINCT FROM 'VALIDATED') THEN

    SELECT status INTO v_period_status FROM accounting_periods WHERE id = NEW.period_id;

    IF v_period_status IN ('CLOSED', 'LOCKED') THEN
      RAISE EXCEPTION 'Exercice % : impossible de créer, déplacer ou valider une écriture dans un exercice %.', NEW.period_id, v_period_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_c_prevent_entry_in_closed_period
  BEFORE INSERT OR UPDATE ON accounting_entries
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_entry_in_closed_period();

-- =====================================================================
-- D. INTÉGRITÉ DU LETTRAGE
--
-- Le lettrage regroupe un nombre quelconque de lignes débit et crédit
-- d'un même compte auxiliaire (ex: une facture + deux règlements
-- partiels). Le trigger se déclenche au moment où `is_balanced` passe
-- à true (jamais avant, puisque les lignes sont rattachées au fur et à
-- mesure par des UPDATE successifs sur accounting_entry_lines.lettering_id
-- avant que le lettrage ne soit clôturé) et vérifie deux choses :
-- au moins deux lignes rattachées, et une somme (débit - crédit) des
-- lignes rattachées strictement égale à zéro.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_check_lettering_balance() RETURNS TRIGGER AS $$
DECLARE
  v_sum   DECIMAL(18,2);
  v_count INTEGER;
BEGIN
  IF NEW.is_balanced = true AND (TG_OP = 'INSERT' OR OLD.is_balanced IS DISTINCT FROM true) THEN

    SELECT
      COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE -amount END), 0),
      COUNT(*)
    INTO v_sum, v_count
    FROM accounting_entry_lines
    WHERE lettering_id = NEW.id;

    IF v_count < 2 THEN
      RAISE EXCEPTION 'Lettrage %: doit regrouper au moins deux lignes (trouvé: %)', NEW.id, v_count;
    END IF;

    IF v_sum <> 0 THEN
      RAISE EXCEPTION 'Lettrage %: déséquilibré (somme débit-crédit = %, doit être 0)', NEW.id, v_sum;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_d_check_lettering_balance
  BEFORE INSERT OR UPDATE ON letterings
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_lettering_balance();

-- =====================================================================
-- E. NUMÉROTATION ATOMIQUE
--
-- fn_next_document_number verrouille (SELECT ... FOR UPDATE) la ligne
-- numbering_sequences correspondant à (company_id, document_type,
-- scope_key) avant de l'incrémenter. Toute transaction concurrente qui
-- appelle cette fonction pour la même clé est mise en attente par
-- PostgreSQL jusqu'au COMMIT (ou ROLLBACK) de la première — deux appels
-- simultanés ne peuvent donc jamais lire la même current_value : c'est
-- PostgreSQL lui-même (verrou de ligne), pas le code applicatif, qui
-- garantit l'unicité même sous forte concurrence. La ligne de séquence
-- est créée à la volée (INSERT ... ON CONFLICT DO NOTHING) si elle
-- n'existe pas encore pour cette entreprise/type de document.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_next_document_number(
  p_company_id TEXT,
  p_document_type "SequenceDocumentType",
  p_scope_key TEXT DEFAULT ''
) RETURNS TEXT AS $$
DECLARE
  v_seq RECORD;
  v_number TEXT;
BEGIN
  INSERT INTO numbering_sequences (id, company_id, document_type, scope_key, current_value, padding, updated_at)
  VALUES (gen_random_uuid()::text, p_company_id, p_document_type, p_scope_key, 0, 6, now())
  ON CONFLICT (company_id, document_type, scope_key) DO NOTHING;

  SELECT * INTO v_seq
  FROM numbering_sequences
  WHERE company_id = p_company_id
    AND document_type = p_document_type
    AND scope_key = p_scope_key
  FOR UPDATE; -- verrou : bloque tout appel concurrent sur cette même clé

  UPDATE numbering_sequences
  SET current_value = v_seq.current_value + 1,
      updated_at = now()
  WHERE id = v_seq.id;

  v_number := COALESCE(v_seq.prefix, '') || LPAD((v_seq.current_value + 1)::text, v_seq.padding, '0');
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- F. DÉNORMALISATION AUTOMATIQUE DE company_id
--
-- Complète, au niveau base de données, le filet de sécurité multi-tenant
-- posé dans le schéma Prisma (Étape 2) : company_id est recalculé et
-- imposé depuis la table parente à chaque INSERT, quelle que soit la
-- valeur transmise par l'application. Il devient donc impossible, même
-- par erreur applicative, qu'une ligne de détail porte un company_id
-- différent de celui de son parent.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_set_company_id_from_entry() RETURNS TRIGGER AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM accounting_entries WHERE id = NEW.entry_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_f_set_company_id_entry_lines
  BEFORE INSERT ON accounting_entry_lines
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_entry();

CREATE OR REPLACE FUNCTION fn_set_company_id_from_invoice() RETURNS TRIGGER AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM invoices WHERE id = NEW.invoice_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_f_set_company_id_invoice_items
  BEFORE INSERT ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_invoice();

CREATE OR REPLACE FUNCTION fn_set_company_id_from_quote() RETURNS TRIGGER AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM quotes WHERE id = NEW.quote_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_f_set_company_id_quote_items
  BEFORE INSERT ON quote_items
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_quote();

CREATE OR REPLACE FUNCTION fn_set_company_id_from_cash_account() RETURNS TRIGGER AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM cash_accounts WHERE id = NEW.cash_account_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_f_set_company_id_cash_transactions
  BEFORE INSERT ON cash_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_cash_account();

CREATE OR REPLACE FUNCTION fn_set_company_id_from_bank_account() RETURNS TRIGGER AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM bank_accounts WHERE id = NEW.bank_account_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_f_set_company_id_bank_transactions
  BEFORE INSERT ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_bank_account();
CREATE TRIGGER trg_f_set_company_id_bank_reconciliations
  BEFORE INSERT ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_bank_account();

CREATE OR REPLACE FUNCTION fn_set_company_id_from_fixed_asset() RETURNS TRIGGER AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM fixed_assets WHERE id = NEW.fixed_asset_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_f_set_company_id_depreciation_entries
  BEFORE INSERT ON depreciation_entries
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_fixed_asset();

CREATE OR REPLACE FUNCTION fn_set_company_id_from_budget() RETURNS TRIGGER AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM budgets WHERE id = NEW.budget_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_f_set_company_id_budget_lines
  BEFORE INSERT ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION fn_set_company_id_from_budget();
