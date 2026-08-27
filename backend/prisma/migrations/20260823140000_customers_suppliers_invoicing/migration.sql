-- =====================================================================
-- Étape 10 — Clients, fournisseurs, devis, factures, paiements.
--
-- Deux évolutions de schéma, toutes deux réellement nécessaires
-- (identifiées par inventaire — Customer/Supplier/Quote/Invoice/
-- Payment existaient déjà et sont réutilisés sans autre modification) :
--
-- 1) Customer.account_id / Supplier.account_id (nullable) : le cahier
--    des charges liste explicitement le « compte comptable associé »
--    comme champ requis d'un client/fournisseur, absent du modèle
--    existant. FK vers Account (jamais un numéro de compte codé en
--    dur) — validée côté service pour n'accepter que des comptes de
--    classe 4 (« Comptes de tiers », même métadonnée qu'à l'Étape 9).
--
-- 2) Table payment_allocations : Payment ne portait qu'une FK unique
--    invoice_id — incapable de représenter un paiement réparti sur
--    plusieurs factures (§10 du cahier des charges). Cette table de
--    jonction (payment_id, invoice_id, amount) devient la source de
--    vérité pour l'affectation ; payment.invoice_id reste tel quel
--    pour compatibilité (renseigné pour le cas simple 1 paiement = 1
--    facture), mais amount_paid/statut des factures sont désormais
--    calculés depuis payment_allocations, jamais depuis payment.amount
--    seul.
-- =====================================================================

ALTER TABLE customers ADD COLUMN account_id TEXT;
ALTER TABLE customers ADD CONSTRAINT customers_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE suppliers ADD COLUMN account_id TEXT;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

CREATE TABLE payment_allocations (
  id         TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  amount     NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT payment_allocations_amount_positive CHECK (amount > 0),
  CONSTRAINT payment_allocations_unique_pair UNIQUE (payment_id, invoice_id)
);

CREATE INDEX payment_allocations_payment_id_idx ON payment_allocations(payment_id);
CREATE INDEX payment_allocations_invoice_id_idx ON payment_allocations(invoice_id);
CREATE INDEX payment_allocations_company_id_idx ON payment_allocations(company_id);

-- =====================================================================
-- Intégrité : le montant total affecté à une facture (somme des
-- payment_allocations) ne doit jamais dépasser le total de la facture.
-- Défense en profondeur — le service applicatif vérifie déjà cette
-- règle avant insertion, ce trigger est la dernière barrière SQL,
-- cohérente avec le principe déjà appliqué aux écritures et au
-- lettrage (Étapes 3, 7, 9).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_check_allocation_not_overpaid() RETURNS TRIGGER AS $$
DECLARE
  v_invoice_total NUMERIC(18,2);
  v_allocated_sum NUMERIC(18,2);
BEGIN
  SELECT total INTO v_invoice_total FROM invoices WHERE id = NEW.invoice_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_allocated_sum
  FROM payment_allocations
  WHERE invoice_id = NEW.invoice_id;

  IF v_allocated_sum > v_invoice_total THEN
    RAISE EXCEPTION 'Facture %: montant affecté (%) dépasse le total de la facture (%).', NEW.invoice_id, v_allocated_sum, v_invoice_total;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_allocation_not_overpaid
  AFTER INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_allocation_not_overpaid();
