/**
 * Tests de concurrence RÉELS pour le lettrage (Étape 9) : deux
 * connexions PostgreSQL distinctes tentent de lettrer la même ligne
 * simultanément — même principe que les tests de concurrence de
 * l'Étape 7.
 *
 * Exécution : npx ts-node test/lettering/concurrency_test.ts
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
  await setup.query(`DELETE FROM accounting_entry_lines WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Conc %')`);
  await setup.query(`DELETE FROM letterings WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Conc %')`);
  await setup.query(`DELETE FROM accounting_entries WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Conc %')`);
  await setup.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Conc %')`);
  await setup.query(`DELETE FROM journals WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Conc %')`);
  await setup.query(`DELETE FROM accounting_periods WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Conc %')`);
  await setup.query(`DELETE FROM numbering_sequences WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Conc %')`);
  await setup.query(`DELETE FROM companies WHERE name LIKE 'Step9Conc %'`);
  await setup.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await setup.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await setup.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await setup.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await setup.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step9conc-user@example.com', 'x', 'Conc', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyId = randomUUID();
  await setup.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step9Conc Entreprise', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyId, frameworkId],
  );
  const periodId = randomUUID();
  await setup.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Exercice 2026', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodId, companyId],
  );
  const journalId = randomUUID();
  await setup.query(
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'VT', 'Ventes', 'SALES', now(), now())`,
    [journalId, companyId],
  );
  const accId = randomUUID();
  const sinkId = randomUUID();
  await setup.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '411100', 'Client', 2, true, now(), now())`,
    [accId, companyId, frameworkId, classByCode.get('4')],
  );
  await setup.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '707000', 'Ventes', 1, true, now(), now())`,
    [sinkId, companyId, frameworkId, classByCode.get('7')],
  );

  async function nextNumber(): Promise<string> {
    const { rows } = await setup.query(`SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'VT') as number`, [companyId]);
    return `VT-${rows[0].number}`;
  }

  async function createValidatedLine(side: 'DEBIT' | 'CREDIT', amount: number, date: string): Promise<string> {
    const entryId = randomUUID();
    const num = await nextNumber();
    await setup.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Test conc', 'DRAFT', $7, now(), now())`,
      [entryId, companyId, periodId, journalId, num, date, userId],
    );
    const lineId = randomUUID();
    await setup.query(
      `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,$5,$6,now())`,
      [lineId, entryId, accId, companyId, side, amount],
    );
    await setup.query(
      `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,$5,$6,now())`,
      [randomUUID(), entryId, sinkId, companyId, side === 'DEBIT' ? 'CREDIT' : 'DEBIT', amount],
    );
    await setup.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    return lineId;
  }

  // Trois lignes : une ligne cible (contestée) + deux contreparties
  // différentes tentées par deux "utilisateurs" concurrents.
  const contestedLine = await createValidatedLine('DEBIT', 1000, '2026-08-01');
  const counterpartyA = await createValidatedLine('CREDIT', 1000, '2026-08-02');
  const counterpartyB = await createValidatedLine('CREDIT', 1000, '2026-08-03');

  async function nextLetteringCode(c: Client): Promise<string> {
    const { rows } = await c.query(`SELECT fn_next_document_number($1, 'LETTERING'::"SequenceDocumentType", $2) as number`, [companyId, accId]);
    return `A${rows[0].number}`;
  }

  // Reproduit exactement la logique transactionnelle du service :
  // création du lettrage puis UPDATE conditionné à lettering_id IS NULL,
  // avec vérification du nombre de lignes réellement affectées.
  async function attemptLettering(c: Client, lineIds: string[]): Promise<'ok' | 'conflict' | 'error'> {
    try {
      await c.query('BEGIN');
      const code = await nextLetteringCode(c);
      const letteringId = randomUUID();
      await c.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1,$2,$3,$4,false,$5,now())`, [
        letteringId, companyId, accId, code, userId,
      ]);
      const result = await c.query(
        `UPDATE accounting_entry_lines SET lettering_id = $1 WHERE id = ANY($2::text[]) AND company_id = $3 AND account_id = $4 AND lettering_id IS NULL`,
        [letteringId, lineIds, companyId, accId],
      );
      if (result.rowCount !== lineIds.length) {
        await c.query('ROLLBACK');
        return 'conflict';
      }
      await c.query('COMMIT');
      return 'ok';
    } catch {
      await c.query('ROLLBACK').catch(() => {});
      return 'error';
    }
  }

  const clientA = await setupClient();
  const clientB = await setupClient();

  // 35-36. Deux lettrages simultanés tentent d'utiliser la MÊME ligne
  // contestée (avec des contreparties différentes) — un seul doit
  // réussir. Le second UPDATE bloque sur le verrou de ligne posé par le
  // premier (transaction A non encore validée) puis échoue la
  // condition lettering_id IS NULL une fois le verrou libéré.
  const [resA, resB] = await Promise.all([
    attemptLettering(clientA, [contestedLine, counterpartyA]),
    attemptLettering(clientB, [contestedLine, counterpartyB]),
  ]);
  const successCount = [resA, resB].filter((r) => r === 'ok').length;
  ok(`35-36. Un seul des deux lettrages concurrents sur la ligne contestée réussit (A=${resA}, B=${resB})`, successCount === 1);

  // 37. Aucun état incohérent : la ligne contestée est rattachée à
  // EXACTEMENT un lettrage (jamais zéro, jamais deux).
  const { rows: contestedState } = await setup.query(`SELECT lettering_id FROM accounting_entry_lines WHERE id = $1`, [contestedLine]);
  ok('37. La ligne contestée est rattachée à exactement un lettrage (aucun état incohérent)', contestedState[0].lettering_id !== null);

  // 38. Aucune association double : la contrepartie du lettrage perdant
  // reste totalement libre (jamais rattachée à un lettrage fantôme).
  const loserCounterparty = resA === 'ok' ? counterpartyB : counterpartyA;
  const { rows: loserState } = await setup.query(`SELECT lettering_id FROM accounting_entry_lines WHERE id = $1`, [loserCounterparty]);
  ok('38. La contrepartie du lettrage en conflit reste libre (aucune association double)', loserState[0].lettering_id === null);

  await clientA.end();
  await clientB.end();

  // Nettoyage
  await setup.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await setup.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await setup.query(`DELETE FROM accounting_entry_lines WHERE company_id = $1`, [companyId]);
  await setup.query(`DELETE FROM letterings WHERE company_id = $1`, [companyId]);
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
  console.error('Erreur lors de l\'exécution des tests de concurrence lettrage:', err);
  process.exit(1);
});
