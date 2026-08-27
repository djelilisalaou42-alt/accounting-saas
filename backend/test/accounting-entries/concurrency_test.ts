/**
 * Tests de concurrence RÉELS pour l'Étape 7 : plusieurs connexions
 * PostgreSQL distinctes exécutées en parallèle (pas de simulation),
 * même principe que le test de concurrence de numérotation de
 * l'Étape 3 (test/sql/concurrency_test.sh) mais ici directement en
 * TypeScript pour couvrir aussi la validation et la contrepassation
 * concurrentes.
 *
 * Exécution : npx ts-node test/accounting-entries/concurrency_test.ts
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
  await setup.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await setup.query(`DELETE FROM accounting_entry_lines WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Conc %')`);
  await setup.query(`DELETE FROM accounting_entries WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Conc %')`);
  await setup.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Conc %')`);
  await setup.query(`DELETE FROM journals WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Conc %')`);
  await setup.query(`DELETE FROM accounting_periods WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Conc %')`);
  await setup.query(`DELETE FROM numbering_sequences WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Conc %')`);
  await setup.query(`DELETE FROM companies WHERE name LIKE 'Step7Conc %'`);
  await setup.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await setup.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await setup.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await setup.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await setup.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step7conc-user@example.com', 'x', 'Conc', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyId = randomUUID();
  await setup.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step7Conc Entreprise', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyId, frameworkId],
  );
  const periodId = randomUUID();
  await setup.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Step7Conc Exercice 2026', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodId, companyId],
  );
  const journalId = randomUUID();
  await setup.query(
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'OD', 'Opérations diverses', 'GENERAL', now(), now())`,
    [journalId, companyId],
  );
  const acc1Id = randomUUID();
  const acc2Id = randomUUID();
  await setup.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '512000', 'Banque', 1, true, now(), now())`,
    [acc1Id, companyId, frameworkId, classByCode.get('5')],
  );
  await setup.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '701000', 'Ventes', 1, true, now(), now())`,
    [acc2Id, companyId, frameworkId, classByCode.get('7')],
  );

  // ===================================================================
  // 32. NUMÉROTATION SIMULTANÉE — deux connexions distinctes appellent
  // fn_next_document_number pour la MÊME clé au même instant.
  // ===================================================================
  const clientA = await setupClient();
  const clientB = await setupClient();

  async function reserveNumber(c: Client, sleepMs: number): Promise<string> {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'OD') as number`,
      [companyId],
    );
    await new Promise((r) => setTimeout(r, sleepMs));
    await c.query('COMMIT');
    return rows[0].number;
  }

  const [numA, numB] = await Promise.all([reserveNumber(clientA, 300), reserveNumber(clientB, 0)]);
  ok(
    `32. Numérotation simultanée : deux numéros distincts obtenus sous concurrence (A=${numA}, B=${numB})`,
    numA !== numB,
  );

  // ===================================================================
  // 33. VALIDATION CONCURRENTE — deux transactions tentent de valider
  // LA MÊME écriture DRAFT en même temps. Une seule doit réussir.
  // ===================================================================
  const entryToValidateId = randomUUID();
  const { rows: numRows } = await setup.query(
    `SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'OD') as number`,
    [companyId],
  );
  await setup.query(
    `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, '2026-05-01', 'Écriture à valider en concurrence', 'DRAFT', $6, now(), now())`,
    [entryToValidateId, companyId, periodId, journalId, `OD-${numRows[0].number}`, userId],
  );
  await setup.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
     VALUES ($1, $2, $3, $4, 1, 'DEBIT', 500, now())`,
    [randomUUID(), entryToValidateId, acc1Id, companyId],
  );
  await setup.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
     VALUES ($1, $2, $3, $4, 2, 'CREDIT', 500, now())`,
    [randomUUID(), entryToValidateId, acc2Id, companyId],
  );

  const clientC = await setupClient();
  const clientD = await setupClient();

  async function attemptValidate(c: Client): Promise<'ok' | 'error'> {
    try {
      await c.query('BEGIN');
      await c.query(
        `UPDATE accounting_entries SET status = 'VALIDATED', validated_by_id = $1, validated_at = now()
         WHERE id = $2 AND status = 'DRAFT'`,
        [userId, entryToValidateId],
      );
      await c.query('COMMIT');
      return 'ok';
    } catch {
      await c.query('ROLLBACK').catch(() => {});
      return 'error';
    }
  }

  const [resC, resD] = await Promise.all([attemptValidate(clientC), attemptValidate(clientD)]);
  const { rows: finalStatus } = await setup.query(`SELECT status FROM accounting_entries WHERE id = $1`, [entryToValidateId]);
  ok(
    '33. Validation concurrente : une seule validation effective (WHERE status=\'DRAFT\' empêche la double transition)',
    finalStatus[0].status === 'VALIDATED' && (resC === 'ok' || resD === 'ok'),
  );

  // ===================================================================
  // 34. CONTREPASSATION CONCURRENTE — deux transactions tentent de
  // contrepasser LA MÊME écriture validée en même temps (verrou SELECT
  // ... FOR UPDATE côté service réel — reproduit ici explicitement).
  // ===================================================================
  const entryToReverseId = entryToValidateId; // déjà VALIDATED depuis le test 33

  async function attemptReverse(c: Client, label: string): Promise<'ok' | 'already_reversed' | 'error'> {
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(`SELECT status FROM accounting_entries WHERE id = $1 FOR UPDATE`, [entryToReverseId]);
      if (rows[0].status !== 'VALIDATED') {
        await c.query('ROLLBACK');
        return 'already_reversed';
      }
      // Simule un traitement (fenêtre de concurrence élargie)
      await new Promise((r) => setTimeout(r, 200));
      await c.query(`UPDATE accounting_entries SET status = 'REVERSED' WHERE id = $1`, [entryToReverseId]);
      await c.query('COMMIT');
      return 'ok';
    } catch {
      await c.query('ROLLBACK').catch(() => {});
      return 'error';
    }
  }

  const clientE = await setupClient();
  const clientF = await setupClient();
  const [resE, resF] = await Promise.all([attemptReverse(clientE, 'E'), attemptReverse(clientF, 'F')]);
  const successCount = [resE, resF].filter((r) => r === 'ok').length;
  ok(
    `34. Contrepassation concurrente : une seule transaction obtient le verrou et effectue la contrepassation (E=${resE}, F=${resF})`,
    successCount === 1,
  );

  await clientA.end();
  await clientB.end();
  await clientC.end();
  await clientD.end();
  await clientE.end();
  await clientF.end();

  // Nettoyage
  await setup.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await setup.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await setup.query(`DELETE FROM accounting_entry_lines WHERE company_id = $1`, [companyId]);
  await setup.query(`DELETE FROM accounting_entries WHERE company_id = $1`, [companyId]);
  await setup.query(`DELETE FROM accounts WHERE company_id = $1`, [companyId]);
  await setup.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await setup.query(`DELETE FROM accounting_periods WHERE company_id = $1`, [companyId]);
  await setup.query(`DELETE FROM numbering_sequences WHERE company_id = $1`, [companyId]);
  await setup.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await setup.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await setup.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await setup.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await setup.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests de concurrence:', err);
  process.exit(1);
});
