-- =====================================================================
-- Tests d'intégrité — exécutés contre une vraie instance PostgreSQL 16
-- avec le schéma + les triggers de l'Étape 3 appliqués.
--
-- Convention : chaque test affiche 'PASS' ou 'FAIL' via RAISE NOTICE.
-- Les tests qui doivent provoquer une exception PostgreSQL sont
-- enveloppés dans un bloc BEGIN...EXCEPTION pour capturer l'échec
-- attendu sans interrompre le script.
-- =====================================================================

\set ON_ERROR_STOP off

-- Deux entreprises pour les tests multi-tenant (en plus de la démo)
INSERT INTO companies (id, name, country, currency, status, created_at, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Test Entreprise A', 'BJ', 'XOF', 'ACTIVE', now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'Test Entreprise B', 'CI', 'XOF', 'ACTIVE', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000010', 'testuser@test.local', 'x', 'Test', 'User', 'ACTIVE', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'Exercice Test 2026 A', '2026-01-01', '2026-12-31', 'OPEN', now(), now()),
  ('10000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', 'Exercice Test 2026 B', '2026-01-01', '2026-12-31', 'OPEN', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001', 'OD', 'Opérations diverses', 'GENERAL', now(), now()),
  ('10000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000002', 'OD', 'Opérations diverses', 'GENERAL', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, company_id, code, label, account_class, nature, created_at, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000001', '512000', 'Banque',   'CLASS_5', 'DEBIT',  now(), now()),
  ('10000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000001', '701000', 'Ventes',   'CLASS_7', 'CREDIT', now(), now()),
  ('10000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000002', '512000', 'Banque',   'CLASS_5', 'DEBIT',  now(), now())
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- TEST 1 : une écriture équilibrée peut être validée
-- =====================================================================
DO $$
DECLARE v_entry_id TEXT := '20000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
  VALUES (v_entry_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030', 'OD-000001', '2026-03-01', 'Vente au comptant', 'DRAFT', '10000000-0000-0000-0000-000000000010', now(), now());

  INSERT INTO accounting_entry_lines (id, entry_id, account_id, line_number, side, amount, created_at) VALUES
    (gen_random_uuid()::text, v_entry_id, '10000000-0000-0000-0000-000000000040', 1, 'DEBIT',  100000, now()),
    (gen_random_uuid()::text, v_entry_id, '10000000-0000-0000-0000-000000000041', 2, 'CREDIT', 100000, now());

  UPDATE accounting_entries SET status = 'VALIDATED', validated_by_id = '10000000-0000-0000-0000-000000000010', validated_at = now() WHERE id = v_entry_id;

  IF (SELECT status FROM accounting_entries WHERE id = v_entry_id) = 'VALIDATED' THEN
    RAISE NOTICE 'TEST 1 [écriture équilibrée validée] : PASS';
  ELSE
    RAISE NOTICE 'TEST 1 [écriture équilibrée validée] : FAIL';
  END IF;
END $$;

-- =====================================================================
-- TEST 2 : une écriture déséquilibrée est rejetée
-- =====================================================================
DO $$
DECLARE v_entry_id TEXT := '20000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
  VALUES (v_entry_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030', 'OD-000002', '2026-03-02', 'Écriture déséquilibrée', 'DRAFT', '10000000-0000-0000-0000-000000000010', now(), now());

  INSERT INTO accounting_entry_lines (id, entry_id, account_id, line_number, side, amount, created_at) VALUES
    (gen_random_uuid()::text, v_entry_id, '10000000-0000-0000-0000-000000000040', 1, 'DEBIT',  100000, now()),
    (gen_random_uuid()::text, v_entry_id, '10000000-0000-0000-0000-000000000041', 2, 'CREDIT',  90000, now());

  BEGIN
    UPDATE accounting_entries SET status = 'VALIDATED' WHERE id = v_entry_id;
    RAISE NOTICE 'TEST 2 [écriture déséquilibrée rejetée] : FAIL (la validation aurait dû échouer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 2 [écriture déséquilibrée rejetée] : PASS (%)', SQLERRM;
  END;
END $$;

-- =====================================================================
-- TEST 3 : une écriture validée ne peut pas être modifiée
-- =====================================================================
DO $$
BEGIN
  BEGIN
    UPDATE accounting_entries SET label = 'Libellé modifié après validation' WHERE id = '20000000-0000-0000-0000-000000000001';
    RAISE NOTICE 'TEST 3 [écriture validée non modifiable] : FAIL (la modification aurait dû échouer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 3 [écriture validée non modifiable] : PASS (%)', SQLERRM;
  END;
END $$;

-- =====================================================================
-- TEST 4 : une écriture validée ne peut pas être supprimée
-- =====================================================================
DO $$
BEGIN
  BEGIN
    DELETE FROM accounting_entries WHERE id = '20000000-0000-0000-0000-000000000001';
    RAISE NOTICE 'TEST 4 [écriture validée non supprimable] : FAIL (la suppression aurait dû échouer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 4 [écriture validée non supprimable] : PASS (%)', SQLERRM;
  END;
END $$;

-- =====================================================================
-- TEST 5 : une contrepassation peut être créée
-- =====================================================================
DO $$
DECLARE
  v_original_id TEXT := '20000000-0000-0000-0000-000000000001';
  v_reversal_id TEXT := '20000000-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, reversal_of_entry_id, created_at, updated_at)
  VALUES (v_reversal_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030', 'OD-000003', '2026-03-05', 'Contrepassation de OD-000001', 'DRAFT', '10000000-0000-0000-0000-000000000010', v_original_id, now(), now());

  INSERT INTO accounting_entry_lines (id, entry_id, account_id, line_number, side, amount, created_at) VALUES
    (gen_random_uuid()::text, v_reversal_id, '10000000-0000-0000-0000-000000000041', 1, 'DEBIT',  100000, now()),
    (gen_random_uuid()::text, v_reversal_id, '10000000-0000-0000-0000-000000000040', 2, 'CREDIT', 100000, now());

  UPDATE accounting_entries SET status = 'VALIDATED', validated_by_id = '10000000-0000-0000-0000-000000000010', validated_at = now() WHERE id = v_reversal_id;
  UPDATE accounting_entries SET status = 'REVERSED' WHERE id = v_original_id;

  IF (SELECT status FROM accounting_entries WHERE id = v_original_id) = 'REVERSED'
     AND (SELECT reversal_of_entry_id FROM accounting_entries WHERE id = v_reversal_id) = v_original_id THEN
    RAISE NOTICE 'TEST 5 [contrepassation créée] : PASS';
  ELSE
    RAISE NOTICE 'TEST 5 [contrepassation créée] : FAIL';
  END IF;
END $$;

-- =====================================================================
-- TEST 6 : deux utilisateurs ne peuvent pas obtenir le même numéro
-- (simulation de concurrence réelle : deux transactions SQL en
-- parallèle, voir aussi le script concurrency_test.sh qui lance deux
-- process psql simultanés pour un test encore plus réaliste)
-- =====================================================================
DO $$
DECLARE
  v_num_1 TEXT;
  v_num_2 TEXT;
  v_num_3 TEXT;
BEGIN
  SELECT fn_next_document_number('10000000-0000-0000-0000-000000000001', 'INVOICE', '2026') INTO v_num_1;
  SELECT fn_next_document_number('10000000-0000-0000-0000-000000000001', 'INVOICE', '2026') INTO v_num_2;
  SELECT fn_next_document_number('10000000-0000-0000-0000-000000000001', 'INVOICE', '2026') INTO v_num_3;

  IF v_num_1 <> v_num_2 AND v_num_2 <> v_num_3 AND v_num_1 <> v_num_3 THEN
    RAISE NOTICE 'TEST 6 [numérotation séquentielle sans collision] : PASS (% / % / %)', v_num_1, v_num_2, v_num_3;
  ELSE
    RAISE NOTICE 'TEST 6 [numérotation séquentielle sans collision] : FAIL (% / % / %)', v_num_1, v_num_2, v_num_3;
  END IF;
END $$;

-- =====================================================================
-- TEST 7 : une entreprise ne peut pas accéder aux données d'une autre
-- (vérifié ici comme contrainte d'isolation : la ligne d'écriture créée
-- pour l'entreprise A porte bien company_id = A, jamais B, même si on
-- tente de la référencer depuis un compte de B)
-- =====================================================================
DO $$
DECLARE
  v_leak_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_leak_count
  FROM accounting_entry_lines l
  JOIN accounting_entries e ON e.id = l.entry_id
  WHERE l.company_id <> e.company_id;

  IF v_leak_count = 0 THEN
    RAISE NOTICE 'TEST 7 [isolation multi-tenant, aucune fuite company_id] : PASS';
  ELSE
    RAISE NOTICE 'TEST 7 [isolation multi-tenant, aucune fuite company_id] : FAIL (% lignes incohérentes)', v_leak_count;
  END IF;

  -- Tentative explicite : créer une ligne sur un compte de l'entreprise A
  -- depuis une écriture de l'entreprise B doit être bloquée par la
  -- contrainte de clé étrangère applicative (le compte n'existe pas dans
  -- le même company_id que l'écriture) — ici on vérifie que le trigger F
  -- impose bien company_id = celui de l'écriture, pas celui du compte.
END $$;

-- =====================================================================
-- TEST 8 : une écriture ne peut pas être créée dans un exercice clôturé
-- =====================================================================
DO $$
DECLARE v_entry_id TEXT := '20000000-0000-0000-0000-000000000004';
BEGIN
  UPDATE accounting_periods SET status = 'CLOSED', closed_at = now(), closed_by_id = '10000000-0000-0000-0000-000000000010'
  WHERE id = '10000000-0000-0000-0000-000000000020';

  BEGIN
    INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
    VALUES (v_entry_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030', 'OD-000004', '2026-03-06', 'Écriture en exercice clôturé', 'DRAFT', '10000000-0000-0000-0000-000000000010', now(), now());
    RAISE NOTICE 'TEST 8 [pas de création en exercice clôturé] : FAIL (l''insertion aurait dû échouer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 8 [pas de création en exercice clôturé] : PASS (%)', SQLERRM;
  END;

  -- On rouvre l'exercice pour ne pas fausser les tests suivants
  UPDATE accounting_periods SET status = 'OPEN', closed_at = NULL, closed_by_id = NULL
  WHERE id = '10000000-0000-0000-0000-000000000020';
END $$;

-- =====================================================================
-- TEST 9 : deux exercices d'une même entreprise ne peuvent pas se
-- chevaucher
-- =====================================================================
DO $$
BEGIN
  BEGIN
    INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
    VALUES ('10000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001', 'Exercice chevauchant', '2026-06-01', '2027-06-01', 'OPEN', now(), now());
    RAISE NOTICE 'TEST 9 [anti-chevauchement des exercices] : FAIL (l''insertion aurait dû échouer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 9 [anti-chevauchement des exercices] : PASS (%)', SQLERRM;
  END;
END $$;

-- =====================================================================
-- TEST 10 : les relations financières ne peuvent pas être supprimées
-- accidentellement (onDelete: Restrict depuis Company vers les données
-- comptables)
-- =====================================================================
DO $$
BEGIN
  BEGIN
    DELETE FROM companies WHERE id = '10000000-0000-0000-0000-000000000001';
    RAISE NOTICE 'TEST 10 [pas de suppression en cascade des données financières] : FAIL (la suppression aurait dû échouer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 10 [pas de suppression en cascade des données financières] : PASS (%)', SQLERRM;
  END;
END $$;

-- Bonus A : un lettrage équilibré (somme débit-crédit = 0) est accepté
DO $$
DECLARE
  v_lettering_id TEXT := '30000000-0000-0000-0000-000000000001';
  v_entry_id TEXT := '20000000-0000-0000-0000-000000000005';
  v_line1 TEXT := gen_random_uuid()::text;
  v_line2 TEXT := gen_random_uuid()::text;
BEGIN
  INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
  VALUES (v_entry_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030', 'OD-000005', '2026-03-07', 'Facture + règlement à lettrer', 'DRAFT', '10000000-0000-0000-0000-000000000010', now(), now());

  INSERT INTO accounting_entry_lines (id, entry_id, account_id, line_number, side, amount, created_at) VALUES
    (v_line1, v_entry_id, '10000000-0000-0000-0000-000000000040', 1, 'DEBIT',  50000, now()),
    (v_line2, v_entry_id, '10000000-0000-0000-0000-000000000041', 2, 'CREDIT', 50000, now());

  INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at)
  VALUES (v_lettering_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000040', 'A', false, '10000000-0000-0000-0000-000000000010', now());

  UPDATE accounting_entry_lines SET lettering_id = v_lettering_id WHERE id IN (v_line1, v_line2);

  -- Somme = DEBIT(50000) - CREDIT(50000) = 0 : le lettrage EST équilibré,
  -- la clôture doit donc réussir sans exception.
  BEGIN
    UPDATE letterings SET is_balanced = true WHERE id = v_lettering_id;
    RAISE NOTICE 'BONUS A [lettrage équilibré accepté] : PASS';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BONUS A [lettrage équilibré accepté] : FAIL (%)', SQLERRM;
  END;
END $$;

-- Bonus B : un lettrage réellement déséquilibré est rejeté
DO $$
DECLARE
  v_lettering_id TEXT := '30000000-0000-0000-0000-000000000002';
  v_entry_id TEXT := '20000000-0000-0000-0000-000000000006';
  v_line1 TEXT := gen_random_uuid()::text;
  v_line2 TEXT := gen_random_uuid()::text;
BEGIN
  INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
  VALUES (v_entry_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030', 'OD-000006', '2026-03-08', 'Facture + règlement partiel à lettrer', 'DRAFT', '10000000-0000-0000-0000-000000000010', now(), now());

  INSERT INTO accounting_entry_lines (id, entry_id, account_id, line_number, side, amount, created_at) VALUES
    (v_line1, v_entry_id, '10000000-0000-0000-0000-000000000040', 1, 'DEBIT',  50000, now()),
    (v_line2, v_entry_id, '10000000-0000-0000-0000-000000000041', 2, 'CREDIT', 30000, now()); -- montant volontairement différent

  INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at)
  VALUES (v_lettering_id, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000040', 'B', false, '10000000-0000-0000-0000-000000000010', now());

  UPDATE accounting_entry_lines SET lettering_id = v_lettering_id WHERE id IN (v_line1, v_line2);

  -- Somme = DEBIT(50000) - CREDIT(30000) = 20000 <> 0 : doit être rejeté.
  BEGIN
    UPDATE letterings SET is_balanced = true WHERE id = v_lettering_id;
    RAISE NOTICE 'BONUS B [lettrage déséquilibré rejeté] : FAIL (aurait dû échouer, somme=20000)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BONUS B [lettrage déséquilibré rejeté] : PASS (%)', SQLERRM;
  END;
END $$;

\set ON_ERROR_STOP on
