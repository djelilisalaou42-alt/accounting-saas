-- =====================================================================
-- Étape 9 — Moteur de lettrage.
--
-- Le modèle `Lettering` et le trigger `fn_check_lettering_balance`
-- existent déjà depuis l'Étape 2/3 et sont réutilisés SANS
-- modification. Deux évolutions minimales et réellement nécessaires :
--
-- 1) fn_protect_validated_entry_lines (Étape 3) bloque actuellement
--    TOUTE modification d'une ligne d'écriture VALIDATED/REVERSED, y
--    compris `lettering_id` — qui est pourtant le seul mécanisme par
--    lequel le lettrage peut fonctionner (une ligne n'est lettrable
--    que si son écriture est VALIDATED, §4 du cahier des charges).
--    Sans cette évolution, le lettrage serait structurellement
--    impossible. On autorise donc explicitement UN SEUL cas : un
--    UPDATE qui ne change QUE `lettering_id`, tous les autres champs
--    restant strictement identiques (montant, sens, compte, date,
--    libellé, tiers...). Toute autre modification, et tout DELETE,
--    restent strictement interdits comme avant.
--
-- 2) Ajout de `LETTERING` à l'enum SequenceDocumentType pour réutiliser
--    fn_next_document_number (numérotation atomique déjà existante,
--    Étape 3/7) plutôt que d'inventer un nouveau compteur fragile.
-- =====================================================================

ALTER TYPE "SequenceDocumentType" ADD VALUE IF NOT EXISTS 'LETTERING';

CREATE OR REPLACE FUNCTION fn_protect_validated_entry_lines() RETURNS TRIGGER AS $$
DECLARE
  v_status "EntryStatus";
BEGIN
  SELECT status INTO v_status FROM accounting_entries WHERE id = COALESCE(OLD.entry_id, NEW.entry_id);

  IF v_status IN ('VALIDATED', 'REVERSED') THEN
    IF TG_OP = 'UPDATE'
       AND NEW.entry_id = OLD.entry_id
       AND NEW.account_id = OLD.account_id
       AND NEW.company_id = OLD.company_id
       AND NEW.line_number = OLD.line_number
       AND NEW.side = OLD.side
       AND NEW.amount = OLD.amount
       AND NEW.label IS NOT DISTINCT FROM OLD.label
       AND NEW.partner_type IS NOT DISTINCT FROM OLD.partner_type
       AND NEW.partner_id IS NOT DISTINCT FROM OLD.partner_id
       AND NEW.created_at = OLD.created_at
    THEN
      -- Seul lettering_id a changé : lettrage/délettrage d'une ligne
      -- validée, autorisé — n'altère ni le montant, ni le sens, ni le
      -- compte, ni la date, ni aucune donnée comptable de l'écriture.
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Ligne d''écriture (entry_id=%): modification/suppression interdite — l''écriture parente est %.', COALESCE(OLD.entry_id, NEW.entry_id), v_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
