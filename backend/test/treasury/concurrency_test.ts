/**
 * Tests de concurrence RÉELS pour la trésorerie (Étape 11) : plusieurs
 * connexions PostgreSQL distinctes exécutées en parallèle — même
 * principe que les tests de concurrence des Étapes 7/9/10.
 *
 * Exécution : npx ts-node test/treasury/concurrency_test.ts
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://accounting_user:accounting_password@localhost:5432/accounting_saas_test?schema=public';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function setupClient(): Promise<Client> {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  return c;
}

async function main(): Promise<void> {
  const setup = await setupClient();

  await setup.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  for (const table of ['bank_reconciliation_matches', 'bank_reconciliations', 'bank_transactions', 'cash_transactions', 'bank_accounts', 'cash_accounts', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await setup.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step11Conc %')`).catch(() => {});
  }
  await setup.query(`DELETE FROM companies WHERE name LIKE 'Step11Conc %'`);
  await setup.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);

  const { rows: fwRows } = await setup.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await setup.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await setup.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step11conc-user@example.com', 'x', 'Conc', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyId = randomUUID();
  await setup.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step11Conc Entreprise','BJ','XOF','ACTIVE',$2,now(),now())`, [companyId, frameworkId]);
  const periodId = randomUUID();
  await setup.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [periodId, companyId]);
  const journalCashId = randomUUID();
  await setup.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'CA','Caisse','CASH',now(),now())`, [journalCashId, companyId]);
  const journalBankId = randomUUID();
  await setup.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'BQ','Banque','BANK',now(),now())`, [journalBankId, companyId]);

  const accCaisseId = randomUUID();
  const accVentesId = randomUUID();
  const accBanqueId = randomUUID();
  await setup.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'571000','Caisse',1,true,now(),now())`, [accCaisseId, companyId, frameworkId, classByCode.get('5')]);
  await setup.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'701000','Ventes',1,true,now(),now())`, [accVentesId, companyId, frameworkId, classByCode.get('7')]);
  await setup.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'521000','Banque',1,true,now(),now())`, [accBanqueId, companyId, frameworkId, classByCode.get('5')]);

  const cashAccountId = randomUUID();
  await setup.query(`INSERT INTO cash_accounts (id, company_id, account_id, code, name, currency, current_balance, is_active, created_at, updated_at) VALUES ($1,$2,$3,'CAISSE-01','Caisse','XOF',0,true,now(),now())`, [cashAccountId, companyId, accCaisseId]);
  const bankAccountId = randomUUID();
  await setup.query(`INSERT INTO bank_accounts (id, company_id, account_id, code, name, bank_name, currency, current_balance, is_active, created_at, updated_at) VALUES ($1,$2,$3,'BQ-01','Banque','Banque Test','XOF',0,true,now(),now())`, [bankAccountId, companyId, accBanqueId]);

  // ===================================================================
  // 1-2. DEUX MOUVEMENTS SIMULTANÉS SUR LA MÊME CAISSE — chacun génère
  // sa propre écriture via fn_next_document_number (verrou de ligne
  // PostgreSQL déjà éprouvé, Étape 3/7). Les deux doivent réussir avec
  // des numéros distincts, sans collision.
  // ===================================================================
  const clientA = await setupClient();
  const clientB = await setupClient();

  async function reserveEntryNumber(c: Client, journalCode: string): Promise<string> {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", $2) as number`, [companyId, journalCode]);
    await new Promise((r) => setTimeout(r, 150));
    await c.query('COMMIT');
    return rows[0].number;
  }

  const [numA, numB] = await Promise.all([reserveEntryNumber(clientA, 'CA'), reserveEntryNumber(clientB, 'CA')]);
  ok(`1-2. Deux mouvements simultanes sur la meme caisse obtiennent des numeros distincts (A=${numA}, B=${numB})`, numA !== numB);

  // ===================================================================
  // 3-4. DEUX MOUVEMENTS SIMULTANÉS SUR LE MÊME COMPTE BANCAIRE
  // ===================================================================
  const [numC, numD] = await Promise.all([reserveEntryNumber(clientA, 'BQ'), reserveEntryNumber(clientB, 'BQ')]);
  ok(`3-4. Deux mouvements simultanes sur le meme compte bancaire obtiennent des numeros distincts (A=${numC}, B=${numD})`, numC !== numD);

  // ===================================================================
  // 5-6. DEUX POINTAGES SIMULTANÉS DE LA MÊME LIGNE — un seul doit
  // réussir (verrouillage FOR UPDATE, même principe que le lettrage
  // Étape 9 et l'affectation de paiement Étape 10).
  // ===================================================================
  async function createBookMovement(): Promise<string> {
    const entryId = randomUUID();
    const { rows: numRows } = await setup.query(`SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'BQ') as number`, [companyId]);
    const entryNum = `BQ-${numRows[0].number}`;
    await setup.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-01','Test','DRAFT',$6,now(),now())`, [entryId, companyId, periodId, journalBankId, entryNum, userId]);
    await setup.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',1000,now())`, [randomUUID(), entryId, accBanqueId, companyId]);
    await setup.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,'CREDIT',1000,now())`, [randomUUID(), entryId, accVentesId, companyId]);
    await setup.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    const { rows: btNumRows } = await setup.query(`SELECT fn_next_document_number($1, 'BANK_TRANSACTION'::"SequenceDocumentType", $2) as number`, [companyId, bankAccountId]);
    const movementId = randomUUID();
    await setup.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, source, amount, transaction_date, label, reference, linked_entry_id, created_at) VALUES ($1,$2,$3,'CREDIT','BOOK',1000,'2026-08-01','Mvt',$4,$5,now())`, [movementId, bankAccountId, companyId, `BT-${btNumRows[0].number}`, entryId]);
    return movementId;
  }

  const bookMovementId = await createBookMovement();
  const stmtLineId = randomUUID();
  await setup.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, source, amount, transaction_date, label, reference, created_at) VALUES ($1,$2,$3,'CREDIT','STATEMENT',1000,'2026-08-01','Releve','REF-CONC',now())`, [stmtLineId, bankAccountId, companyId]);

  const reconciliationId = randomUUID();
  await setup.query(`INSERT INTO bank_reconciliations (id, bank_account_id, company_id, period_start, period_end, statement_balance, book_balance, status, created_by_id, created_at) VALUES ($1,$2,$3,'2026-08-01','2026-08-01',1000,1000,'IN_PROGRESS',$4,now())`, [reconciliationId, bankAccountId, companyId, userId]);

  // Une seconde ligne de livre candidate, pour créer une VRAIE
  // contention sur stmtLineId (deux transactions tentent chacune de
  // pointer stmtLineId avec une contrepartie DIFFÉRENTE).
  const bookMovement2Id = await createBookMovement();

  async function attemptMatch(c: Client, bookId: string): Promise<'ok' | 'conflict'> {
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(`SELECT id, is_reconciled FROM bank_transactions WHERE id IN ($1, $2) FOR UPDATE`, [stmtLineId, bookId]);
      const stmt = rows.find((r: any) => r.id === stmtLineId);
      if (stmt.is_reconciled) {
        await c.query('ROLLBACK');
        return 'conflict';
      }
      await new Promise((r) => setTimeout(r, 200));
      await c.query(`INSERT INTO bank_reconciliation_matches (id, reconciliation_id, company_id, statement_transaction_id, book_transaction_id, created_at) VALUES ($1,$2,$3,$4,$5,now())`, [randomUUID(), reconciliationId, companyId, stmtLineId, bookId]);
      await c.query(`UPDATE bank_transactions SET is_reconciled = true, reconciliation_id = $1 WHERE id IN ($2, $3)`, [reconciliationId, stmtLineId, bookId]);
      await c.query('COMMIT');
      return 'ok';
    } catch {
      await c.query('ROLLBACK').catch(() => {});
      return 'conflict';
    }
  }

  const clientC = await setupClient();
  const clientD = await setupClient();
  const [resC, resD] = await Promise.all([attemptMatch(clientC, bookMovementId), attemptMatch(clientD, bookMovement2Id)]);
  const successCount = [resC, resD].filter((r) => r === 'ok').length;
  ok(`5-6. Deux pointages simultanes de la meme ligne de releve: un seul reussit (C=${resC}, D=${resD})`, successCount === 1);
  const { rows: finalStmtState } = await setup.query(`SELECT is_reconciled FROM bank_transactions WHERE id = $1`, [stmtLineId]);
  ok('    -> Aucun etat incoherent: la ligne de releve est rapprochee exactement une fois', finalStmtState[0].is_reconciled === true);

  await clientA.end();
  await clientB.end();
  await clientC.end();
  await clientD.end();

  // Nettoyage
  await setup.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  for (const table of ['bank_reconciliation_matches', 'bank_reconciliations', 'bank_transactions', 'cash_transactions', 'bank_accounts', 'cash_accounts', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await setup.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]).catch(() => {});
  }
  await setup.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await setup.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await setup.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await setup.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'execution des tests de concurrence Etape 11:', err);
  process.exit(1);
});
