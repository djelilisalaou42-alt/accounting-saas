-- =====================================================================
-- Étape 10 — Correction d'un vrai bug de concurrence détecté par les
-- tests réels contre PostgreSQL (deux connexions parallèles).
--
-- fn_check_allocation_not_overpaid (migration précédente) calculait la
-- somme des affectations via un simple SELECT SUM(...), sans verrouiller
-- la ligne de la facture. Sous isolation READ COMMITTED (par défaut),
-- deux transactions concurrentes qui affectent chacune un paiement à la
-- MÊME facture voient chacune uniquement les lignes déjà COMMITÉES au
-- moment de leur propre calcul — ni l'une ni l'autre ne voit la ligne
-- de l'autre tant qu'aucune n'a validé sa transaction. Résultat : les
-- deux INSERT passent le contrôle indépendamment, et seule la somme
-- finale (après les deux COMMIT) dépasse le total — trop tard.
--
-- Correction : verrouiller la ligne de la facture (`SELECT ... FOR
-- UPDATE`) AVANT de calculer la somme. La seconde transaction concurrente
-- est alors mise en attente jusqu'au COMMIT/ROLLBACK de la première, et
-- voit ensuite la somme réellement à jour — même principe que le
-- verrouillage déjà utilisé pour la contrepassation (Étape 7,
-- `SELECT ... FOR UPDATE` sur accounting_entries).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_check_allocation_not_overpaid() RETURNS TRIGGER AS $$
DECLARE
  v_invoice_total NUMERIC(18,2);
  v_allocated_sum NUMERIC(18,2);
BEGIN
  -- Verrou de ligne : sérialise les affectations concurrentes sur la
  -- même facture. La seconde transaction attend ici que la première
  -- commite (ou annule) avant de poursuivre son propre contrôle.
  SELECT total INTO v_invoice_total FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0) INTO v_allocated_sum
  FROM payment_allocations
  WHERE invoice_id = NEW.invoice_id;

  IF v_allocated_sum > v_invoice_total THEN
    RAISE EXCEPTION 'Facture %: montant affecté (%) dépasse le total de la facture (%).', NEW.invoice_id, v_allocated_sum, v_invoice_total;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
