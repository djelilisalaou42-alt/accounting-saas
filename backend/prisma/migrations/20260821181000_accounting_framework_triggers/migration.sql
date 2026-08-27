-- =====================================================================
-- Migration: 20260821181000_accounting_framework_triggers
--
-- Défense en profondeur (même pattern qu'aux Étapes 3/5) :
--   A. accounts.framework_id est TOUJOURS imposé depuis
--      account_classes.framework_id — jamais choisi indépendamment,
--      même par un INSERT direct en base.
--   B. Un compte ne peut être créé que si son référentiel (via la
--      classe choisie) correspond au référentiel choisi par
--      l'entreprise (companies.accounting_framework_id).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_set_account_framework_id() RETURNS TRIGGER AS $$
DECLARE
  v_class_framework_id TEXT;
  v_company_framework_id TEXT;
BEGIN
  SELECT framework_id INTO v_class_framework_id FROM account_classes WHERE id = NEW.account_class_id;
  IF v_class_framework_id IS NULL THEN
    RAISE EXCEPTION 'Compte %: classe comptable % introuvable.', NEW.code, NEW.account_class_id;
  END IF;

  NEW.framework_id := v_class_framework_id;

  SELECT accounting_framework_id INTO v_company_framework_id FROM companies WHERE id = NEW.company_id;
  IF v_company_framework_id IS DISTINCT FROM v_class_framework_id THEN
    RAISE EXCEPTION 'Compte %: la classe choisie appartient à un référentiel différent de celui de l''entreprise.', NEW.code;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_account_framework_id
  BEFORE INSERT OR UPDATE OF account_class_id ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_account_framework_id();
