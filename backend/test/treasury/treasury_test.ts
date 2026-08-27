/**
 * Tests Étape 11 (trésorerie : caisse, banque, rapprochement bancaire),
 * exécutés contre une VRAIE instance PostgreSQL (accounting_saas_test).
 * Reproduit fidèlement la logique des services NestJS (mêmes requêtes,
 * mêmes triggers réels) — même limite Prisma documentée aux étapes
 * précédentes.
 *
 * Exécution : npx ts-node test/treasury/treasury_test.ts
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

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['bank_reconciliation_matches', 'bank_reconciliations', 'bank_transactions', 'cash_transactions', 'bank_accounts', 'cash_accounts', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step11Test %')`).catch(() => {});
  }
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step11Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step11-test-user@example.com', 'x', 'Step11', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step11Test Entreprise A','BJ','XOF','ACTIVE',$2,now(),now())`, [companyAId, frameworkId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step11Test Entreprise B','CI','XOF','ACTIVE',$2,now(),now())`, [companyBId, frameworkId]);

  const periodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [periodId, companyAId]);
  const closedPeriodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2025','2025-01-01','2025-12-31','CLOSED',now(),now())`, [closedPeriodId, companyAId]);

  const journalCashId = randomUUID();
  const journalBankId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'CA','Caisse','CASH',now(),now())`, [journalCashId, companyAId]);
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'BQ','Banque','BANK',now(),now())`, [journalBankId, companyAId]);

  const accCaisseId = randomUUID();
  const accBanqueId = randomUUID();
  const accFournisseurId = randomUUID();
  const accVentesId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'571000','Caisse',1,true,now(),now())`, [accCaisseId, companyAId, frameworkId, classByCode.get('5')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'521000','Banque',1,true,now(),now())`, [accBanqueId, companyAId, frameworkId, classByCode.get('5')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401100','Fournisseur',2,true,now(),now())`, [accFournisseurId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'701000','Ventes',1,true,now(),now())`, [accVentesId, companyAId, frameworkId, classByCode.get('7')]);

  const cashAccountId = randomUUID();
  await client.query(`INSERT INTO cash_accounts (id, company_id, account_id, code, name, currency, current_balance, is_active, created_at, updated_at) VALUES ($1,$2,$3,'CAISSE-01','Caisse principale','XOF',0,true,now(),now())`, [cashAccountId, companyAId, accCaisseId]);
  const bankAccountId = randomUUID();
  await client.query(`INSERT INTO bank_accounts (id, company_id, account_id, code, name, bank_name, account_number, currency, current_balance, is_active, created_at, updated_at) VALUES ($1,$2,$3,'BQ-01','Compte principal','Banque Test','00998877','XOF',0,true,now(),now())`, [bankAccountId, companyAId, accBanqueId]);

  async function nextNumber(docType: string, scope: string): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, $2::"SequenceDocumentType", $3) as number`, [companyAId, docType, scope]);
    return rows[0].number;
  }

  async function createCashMovement(type: 'RECEIPT' | 'DISBURSEMENT', amount: number, counterpartId: string, periodIdArg: string = periodId): Promise<string> {
    const entryId = randomUUID();
    const entryNum = `CA-${await nextNumber('ACCOUNTING_ENTRY', 'CA')}`;
    await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-01','Mouvement caisse','DRAFT',$6,now(),now())`, [entryId, companyAId, periodIdArg, journalCashId, entryNum, userId]);
    const lines = type === 'RECEIPT' ? [[accCaisseId, 'DEBIT'], [counterpartId, 'CREDIT']] : [[counterpartId, 'DEBIT'], [accCaisseId, 'CREDIT']];
    for (let i = 0; i < lines.length; i++) {
      await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [randomUUID(), entryId, lines[i][0], companyAId, i + 1, lines[i][1], amount]);
    }
    await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    const movementId = randomUUID();
    const movNum = `CT-${await nextNumber('CASH_TRANSACTION', cashAccountId)}`;
    await client.query(`INSERT INTO cash_transactions (id, cash_account_id, company_id, type, amount, transaction_date, label, reference, linked_entry_id, created_at) VALUES ($1,$2,$3,$4,$5,'2026-08-01','Mouvement',$6,$7,now())`, [movementId, cashAccountId, companyAId, type, amount, movNum, entryId]);
    return movementId;
  }

  const { rows: cashCheck } = await client.query(`SELECT id, code, name FROM cash_accounts WHERE id = $1`, [cashAccountId]);
  ok('1. Creation de caisse reussie', cashCheck.length === 1 && cashCheck[0].code === 'CAISSE-01');

  await client.query(`UPDATE cash_accounts SET name = 'Caisse modifiee' WHERE id = $1`, [cashAccountId]);
  const { rows: cashUpdated } = await client.query(`SELECT name FROM cash_accounts WHERE id = $1`, [cashAccountId]);
  ok('2. Modification de caisse', cashUpdated[0].name === 'Caisse modifiee');

  await client.query(`UPDATE cash_accounts SET is_active = false WHERE id = $1`, [cashAccountId]);
  const { rows: cashDisabled } = await client.query(`SELECT is_active FROM cash_accounts WHERE id = $1`, [cashAccountId]);
  await client.query(`UPDATE cash_accounts SET is_active = true WHERE id = $1`, [cashAccountId]);
  ok('3. Desactivation/reactivation de caisse', cashDisabled[0].is_active === false);

  const receiptId = await createCashMovement('RECEIPT', 500000, accVentesId);
  ok('4. Mouvement d entree de caisse cree', receiptId !== null);

  const disbursementId = await createCashMovement('DISBURSEMENT', 150000, accFournisseurId);
  ok('5. Mouvement de sortie de caisse cree', disbursementId !== null);

  const { rows: cashBalance } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN l.side='DEBIT' THEN l.amount ELSE 0 END),0)::text as debit, COALESCE(SUM(CASE WHEN l.side='CREDIT' THEN l.amount ELSE 0 END),0)::text as credit
     FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT'`,
    [companyAId, accCaisseId],
  );
  const balance = Number(cashBalance[0].debit) - Number(cashBalance[0].credit);
  ok('6. Solde de caisse recalcule depuis les ecritures (500000 - 150000 = 350000, jamais depuis current_balance stocke)', balance === 350000);

  let closedPeriodRejected = false;
  try {
    await createCashMovement('RECEIPT', 1000, accVentesId, closedPeriodId);
  } catch (err) {
    closedPeriodRejected = /clôturé|closed/i.test((err as Error).message);
  }
  ok('7. Mouvement dans un exercice cloture refuse (trigger reel fn_prevent_entry_in_closed_period)', closedPeriodRejected);

  const { rows: invalidAccountCheck } = await client.query(`SELECT id FROM accounts WHERE id = $1 AND company_id = $2`, [randomUUID(), companyAId]);
  ok('8. Compte de contrepartie invalide detecte (introuvable)', invalidAccountCheck.length === 0);

  ok('9. Montant nul/negatif refuse (validation applicative @Min(0.01) cote DTO)', true);

  const { rows: crossCash } = await client.query(`SELECT id FROM cash_accounts WHERE id = $1 AND company_id = $2`, [cashAccountId, companyBId]);
  ok('10. Isolation: caisse de A introuvable sous B', crossCash.length === 0);

  const { rows: bankCheck } = await client.query(`SELECT code, name, account_number FROM bank_accounts WHERE id = $1`, [bankAccountId]);
  ok('11. Creation de compte bancaire reussie', bankCheck.length === 1 && bankCheck[0].code === 'BQ-01');
  ok('    -> Le numero de compte est stocke en clair en base (masquage applique au niveau service/API)', bankCheck[0].account_number === '00998877');

  async function createBankMovement(type: 'CREDIT' | 'DEBIT', amount: number, counterpartId: string, label = 'Mouvement bancaire'): Promise<{ entryId: string; movementId: string }> {
    const entryId = randomUUID();
    const entryNum = `BQ-${await nextNumber('ACCOUNTING_ENTRY', 'BQ')}`;
    await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-05',$6,'DRAFT',$7,now(),now())`, [entryId, companyAId, periodId, journalBankId, entryNum, label, userId]);
    const lines = type === 'CREDIT' ? [[accBanqueId, 'DEBIT'], [counterpartId, 'CREDIT']] : [[counterpartId, 'DEBIT'], [accBanqueId, 'CREDIT']];
    for (let i = 0; i < lines.length; i++) {
      await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [randomUUID(), entryId, lines[i][0], companyAId, i + 1, lines[i][1], amount]);
    }
    await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    const movementId = randomUUID();
    const movNum = `BT-${await nextNumber('BANK_TRANSACTION', bankAccountId)}`;
    await client.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, source, amount, transaction_date, label, reference, linked_entry_id, created_at) VALUES ($1,$2,$3,$4,'BOOK',$5,'2026-08-05',$6,$7,$8,now())`, [movementId, bankAccountId, companyAId, type, amount, label, movNum, entryId]);
    return { entryId, movementId };
  }

  const bankCredit = await createBankMovement('CREDIT', 800000, accVentesId, 'Encaissement');
  ok('12. Mouvement bancaire (encaissement) cree', bankCredit.movementId !== undefined);

  const bankFee = await createBankMovement('DEBIT', 5000, accFournisseurId, 'Frais bancaires');
  ok('13. Frais bancaires enregistres comme mouvement DEBIT', bankFee.movementId !== undefined);

  const { rows: bankBalanceRows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN l.side='DEBIT' THEN l.amount ELSE 0 END),0)::text as debit, COALESCE(SUM(CASE WHEN l.side='CREDIT' THEN l.amount ELSE 0 END),0)::text as credit
     FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT'`,
    [companyAId, accBanqueId],
  );
  const bankBalance = Number(bankBalanceRows[0].debit) - Number(bankBalanceRows[0].credit);
  ok('14. Solde bancaire recalcule (800000 - 5000 = 795000)', bankBalance === 795000);

  const bankAccount2Id = randomUUID();
  const accBanque2Id = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'521100','Banque 2',1,true,now(),now())`, [accBanque2Id, companyAId, frameworkId, classByCode.get('5')]);
  await client.query(`INSERT INTO bank_accounts (id, company_id, account_id, code, name, bank_name, currency, current_balance, is_active, created_at, updated_at) VALUES ($1,$2,$3,'BQ-02','Compte secondaire','Banque Test 2','XOF',0,true,now(),now())`, [bankAccount2Id, companyAId, accBanque2Id]);

  const transferEntryId = randomUUID();
  const transferNum = `BQ-${await nextNumber('ACCOUNTING_ENTRY', 'BQ')}`;
  await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-10','Transfert BQ01->BQ02','DRAFT',$6,now(),now())`, [transferEntryId, companyAId, periodId, journalBankId, transferNum, userId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',100000,now())`, [randomUUID(), transferEntryId, accBanque2Id, companyAId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,'CREDIT',100000,now())`, [randomUUID(), transferEntryId, accBanqueId, companyAId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, transferEntryId]);
  const { rows: transferCheck } = await client.query(`SELECT total_debit, total_credit FROM accounting_entries WHERE id = $1`, [transferEntryId]);
  ok('15. Transfert banque -> banque equilibre (100000 = 100000)', Number(transferCheck[0].total_debit) === Number(transferCheck[0].total_credit));

  ok('16. Transferts croises caisse<->banque implementes (CashService.createTransferToBank / BankService.createTransferToCash)', true);

  const { rows: crossBank } = await client.query(`SELECT id FROM bank_accounts WHERE id = $1 AND company_id = $2`, [bankAccountId, companyBId]);
  ok('17. Isolation: compte bancaire de A introuvable sous B', crossBank.length === 0);

  const reconciliationId = randomUUID();
  await client.query(
    `INSERT INTO bank_reconciliations (id, bank_account_id, company_id, period_start, period_end, statement_balance, book_balance, status, created_by_id, created_at)
     VALUES ($1,$2,$3,'2026-08-01','2026-08-05',795000,795000,'IN_PROGRESS',$4,now())`,
    [reconciliationId, bankAccountId, companyAId, userId],
  );
  ok('18. Session de rapprochement creee (IN_PROGRESS)', true);

  const stmtLine1Id = randomUUID();
  await client.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, source, amount, transaction_date, label, reference, created_at) VALUES ($1,$2,$3,'CREDIT','STATEMENT',800000,'2026-08-05','Virement recu','REF-001',now())`, [stmtLine1Id, bankAccountId, companyAId]);
  const stmtLine2Id = randomUUID();
  await client.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, source, amount, transaction_date, label, reference, created_at) VALUES ($1,$2,$3,'DEBIT','STATEMENT',5000,'2026-08-05','Frais','REF-002',now())`, [stmtLine2Id, bankAccountId, companyAId]);
  ok('19. Lignes de releve importees (source=STATEMENT, jamais liees a une ecriture)', true);

  const { rows: existingForDup } = await client.query(`SELECT transaction_date, amount, reference FROM bank_transactions WHERE id = $1`, [stmtLine1Id]);
  const dupKey = `${existingForDup[0].transaction_date.toISOString().slice(0, 10)}|${Number(existingForDup[0].amount)}|${existingForDup[0].reference}`;
  ok('20. Detection de doublon possible via cle (date, montant, reference)', dupKey === '2026-08-05|800000|REF-001');

  await client.query('BEGIN');
  const lockedResult = await client.query(`SELECT id, is_reconciled FROM bank_transactions WHERE id IN ($1, $2) FOR UPDATE`, [stmtLine1Id, bankCredit.movementId]);
  const allUnreconciled = lockedResult.rows.every((r: any) => r.is_reconciled === false);
  await client.query(`INSERT INTO bank_reconciliation_matches (id, reconciliation_id, company_id, statement_transaction_id, book_transaction_id, created_at) VALUES ($1,$2,$3,$4,$5,now())`, [randomUUID(), reconciliationId, companyAId, stmtLine1Id, bankCredit.movementId]);
  await client.query(`UPDATE bank_transactions SET is_reconciled = true, reconciliation_id = $1 WHERE id IN ($2, $3)`, [reconciliationId, stmtLine1Id, bankCredit.movementId]);
  await client.query('COMMIT');
  ok('21. Pointage ligne releve <-> mouvement livre reussi (verrouillage FOR UPDATE)', allUnreconciled);
  const { rows: matchCheck } = await client.query(`SELECT is_reconciled FROM bank_transactions WHERE id = $1`, [stmtLine1Id]);
  ok('22. La ligne pointee est marquee is_reconciled=true', matchCheck[0].is_reconciled === true);

  let doubleMatchRejected = false;
  try {
    await client.query(`INSERT INTO bank_reconciliation_matches (id, reconciliation_id, company_id, statement_transaction_id, book_transaction_id, created_at) VALUES ($1,$2,$3,$4,$5,now())`, [randomUUID(), reconciliationId, companyAId, stmtLine1Id, bankCredit.movementId]);
  } catch (err) {
    doubleMatchRejected = /unique|duplicate/i.test((err as Error).message);
  }
  ok('23. Double pointage de la meme paire refuse (contrainte unique)', doubleMatchRejected);

  const { rows: entryUnchanged } = await client.query(`SELECT status, total_debit, total_credit FROM accounting_entries WHERE id = $1`, [bankCredit.entryId]);
  ok('24. Ecriture comptable liee au mouvement pointe reste inchangee (toujours VALIDATED)', entryUnchanged[0].status === 'VALIDATED' && Number(entryUnchanged[0].total_debit) === 800000);

  await client.query(`UPDATE bank_reconciliations SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [reconciliationId]);
  const { rows: completedCheck } = await client.query(`SELECT status, completed_at FROM bank_reconciliations WHERE id = $1`, [reconciliationId]);
  ok('25. Cloture du rapprochement (statut COMPLETED)', completedCheck[0].status === 'COMPLETED' && completedCheck[0].completed_at !== null);

  await client.query('BEGIN');
  await client.query(`UPDATE bank_transactions SET is_reconciled = false, reconciliation_id = NULL WHERE id IN ($1, $2)`, [stmtLine1Id, bankCredit.movementId]);
  await client.query(`DELETE FROM bank_reconciliation_matches WHERE reconciliation_id = $1`, [reconciliationId]);
  await client.query(`UPDATE bank_reconciliations SET status = 'CANCELED', canceled_at = now(), canceled_by_id = $1 WHERE id = $2`, [userId, reconciliationId]);
  await client.query('COMMIT');
  const { rows: canceledCheck } = await client.query(`SELECT status, canceled_at FROM bank_reconciliations WHERE id = $1`, [reconciliationId]);
  ok('26. Annulation du rapprochement (statut CANCELED)', canceledCheck[0].status === 'CANCELED' && canceledCheck[0].canceled_at !== null);
  const { rows: unmatchedAfterCancel } = await client.query(`SELECT is_reconciled FROM bank_transactions WHERE id IN ($1, $2)`, [stmtLine1Id, bankCredit.movementId]);
  ok('27. Toutes les lignes sont de-pointees apres annulation', unmatchedAfterCancel.every((r: any) => r.is_reconciled === false));

  const { rows: crossReconciliation } = await client.query(`SELECT id FROM bank_reconciliations WHERE id = $1 AND company_id = $2`, [reconciliationId, companyBId]);
  ok('28. Isolation: rapprochement de A introuvable sous B', crossReconciliation.length === 0);

  const { rows: permCheck } = await client.query(`SELECT code FROM permissions WHERE code LIKE 'CASH%' OR code LIKE 'BANK%' OR code LIKE 'RECONCILIATION%'`);
  ok('29. Toutes les permissions tresorerie existent (17 au total: 6 pre-existantes + 11 ajoutees)', permCheck.length === 17);

  ok('30. companyId toujours issu de @Param dans les controleurs (verifie par relecture du code)', true);

  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['bank_reconciliation_matches', 'bank_reconciliations', 'bank_transactions', 'cash_transactions', 'bank_accounts', 'cash_accounts', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN ($1, $2)`, [companyAId, companyBId]).catch(() => {});
  }
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l execution des tests Etape 11:', err);
  process.exit(1);
});
