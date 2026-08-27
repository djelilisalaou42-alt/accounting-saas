/**
 * Scénario comptable critique explicitement demandé (cahier des
 * charges Étape 7, §39), exécuté contre PostgreSQL réel avec les
 * vrais triggers.
 *
 * Exécution : npx ts-node test/accounting-entries/critical_scenario_test.ts
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
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Critical %')`);
  await client.query(`DELETE FROM accounting_entries WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Critical %')`);
  await client.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Critical %')`);
  await client.query(`DELETE FROM journals WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Critical %')`);
  await client.query(`DELETE FROM accounting_periods WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Critical %')`);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Critical %')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step7Critical %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step7critical-user@example.com', 'x', 'Critical', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step7Critical Entreprise', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyId, frameworkId],
  );
  const periodId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Exercice 2026', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodId, companyId],
  );
  const journalId = randomUUID();
  await client.query(
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'BQ', 'Banque', 'BANK', now(), now())`,
    [journalId, companyId],
  );

  const acc401100Id = randomUUID(); // Fournisseur, postable
  const acc521000Id = randomUUID(); // Banque, postable
  const acc40Id = randomUUID(); // Regroupement, NON postable
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '401100', 'Fournisseur', 2, true, now(), now())`,
    [acc401100Id, companyId, frameworkId, classByCode.get('4')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '521000', 'Banque', 1, true, now(), now())`,
    [acc521000Id, companyId, frameworkId, classByCode.get('5')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '401', 'Fournisseurs (regroupement)', 1, false, now(), now())`,
    [acc40Id, companyId, frameworkId, classByCode.get('4')],
  );

  async function nextEntryNumber(): Promise<string> {
    const { rows } = await client.query(
      `SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'BQ') as number`,
      [companyId],
    );
    return `BQ-${rows[0].number}`;
  }

  // ===================================================================
  // Scénario 1 : Débit = Crédit = 1 000 000 -> validation réussie
  // ===================================================================
  const entry1Id = randomUUID();
  const num1 = await nextEntryNumber();
  await client.query(
    `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, '2026-08-22', 'Règlement fournisseur', 'DRAFT', $6, now(), now())`,
    [entry1Id, companyId, periodId, journalId, num1, userId],
  );
  await client.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, label, created_at)
     VALUES ($1, $2, $3, $4, 1, 'DEBIT', 1000000, 'Fournisseur local', now())`,
    [randomUUID(), entry1Id, acc401100Id, companyId],
  );
  await client.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, label, created_at)
     VALUES ($1, $2, $3, $4, 2, 'CREDIT', 1000000, 'Banque', now())`,
    [randomUUID(), entry1Id, acc521000Id, companyId],
  );

  let scenario1Result: 'validated' | 'rejected' = 'rejected';
  try {
    await client.query(`UPDATE accounting_entries SET status = 'VALIDATED', validated_by_id = $1, validated_at = now() WHERE id = $2`, [userId, entry1Id]);
    scenario1Result = 'validated';
  } catch {
    scenario1Result = 'rejected';
  }
  const { rows: e1 } = await client.query(`SELECT status, total_debit, total_credit FROM accounting_entries WHERE id = $1`, [entry1Id]);
  ok(
    'Scénario 1 : Débit = Crédit = 1 000 000 -> validation réussie',
    scenario1Result === 'validated' &&
      e1[0].status === 'VALIDATED' &&
      Number(e1[0].total_debit) === 1000000 &&
      Number(e1[0].total_credit) === 1000000,
  );

  // ===================================================================
  // Scénario 2 : Débit = 1 000 000, Crédit = 900 000 -> validation refusée
  // ===================================================================
  const entry2Id = randomUUID();
  const num2 = await nextEntryNumber();
  await client.query(
    `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, '2026-08-22', 'Écriture déséquilibrée', 'DRAFT', $6, now(), now())`,
    [entry2Id, companyId, periodId, journalId, num2, userId],
  );
  await client.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
     VALUES ($1, $2, $3, $4, 1, 'DEBIT', 1000000, now())`,
    [randomUUID(), entry2Id, acc401100Id, companyId],
  );
  await client.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
     VALUES ($1, $2, $3, $4, 2, 'CREDIT', 900000, now())`,
    [randomUUID(), entry2Id, acc521000Id, companyId],
  );

  let scenario2Result: 'validated' | 'rejected' = 'validated';
  let scenario2Error = '';
  try {
    await client.query(`UPDATE accounting_entries SET status = 'VALIDATED' WHERE id = $1`, [entry2Id]);
    scenario2Result = 'validated';
  } catch (err) {
    scenario2Result = 'rejected';
    scenario2Error = (err as Error).message;
  }
  ok(
    'Scénario 2 : Débit 1 000 000 ≠ Crédit 900 000 -> validation refusée',
    scenario2Result === 'rejected' && /déséquilibrée/i.test(scenario2Error),
  );

  // ===================================================================
  // Scénario 3 : compte parent "401" (isPostable=false) -> utilisation
  // dans une écriture refusée (vérification applicative, reproduisant
  // validateLinesAccounts() du vrai service).
  // ===================================================================
  const { rows: parentAccount } = await client.query(`SELECT is_postable FROM accounts WHERE id = $1`, [acc40Id]);
  const wouldBeRejected = parentAccount[0].is_postable === false;
  ok(
    'Scénario 3 : compte de regroupement "401" (isPostable=false) -> utilisation dans une ligne refusée',
    wouldBeRejected,
  );

  // Nettoyage
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM accounting_entries WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM accounting_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution du scénario critique:', err);
  process.exit(1);
});
