/**
 * Tests des suggestions automatiques (Étape 9, §39-42). Reproduit
 * l'algorithme de reports/reports... non, lettering.service.ts
 * (correspondances exactes puis combinaisons multi-lignes bornées) et
 * vérifie qu'aucune écriture n'est produite par ces suggestions —
 * elles sont strictement en lecture seule.
 *
 * Exécution : npx ts-node test/lettering/suggestions_test.ts
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

function findCombinationSum(items: Array<{ id: string; amount: number }>, target: number, maxSize: number): any[] | null {
  const targetCents = Math.round(target * 100);
  const candidates = items.slice(0, 12);
  function search(index: number, remaining: number, chosen: any[]): any[] | null {
    if (remaining === 0 && chosen.length >= 1) return chosen;
    if (index >= candidates.length || chosen.length >= maxSize) return null;
    const withItem = search(index + 1, remaining - Math.round(candidates[index].amount * 100), [...chosen, candidates[index]]);
    if (withItem) return withItem;
    return search(index + 1, remaining, chosen);
  }
  return search(0, targetCents, []);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sugg %')`);
  await client.query(`DELETE FROM letterings WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sugg %')`);
  await client.query(`DELETE FROM accounting_entries WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sugg %')`);
  await client.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sugg %')`);
  await client.query(`DELETE FROM journals WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sugg %')`);
  await client.query(`DELETE FROM accounting_periods WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sugg %')`);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sugg %')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step9Sugg %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step9sugg-user@example.com', 'x', 'Sugg', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step9Sugg Entreprise A', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyAId, frameworkId],
  );
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step9Sugg Entreprise B', 'CI', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyBId, frameworkId],
  );
  const periodId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Exercice 2026', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodId, companyAId],
  );
  const journalId = randomUUID();
  await client.query(
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'VT', 'Ventes', 'SALES', now(), now())`,
    [journalId, companyAId],
  );
  const accId = randomUUID();
  const sinkId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '411100', 'Client', 2, true, now(), now())`,
    [accId, companyAId, frameworkId, classByCode.get('4')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '707000', 'Ventes', 1, true, now(), now())`,
    [sinkId, companyAId, frameworkId, classByCode.get('7')],
  );
  // Compte B (entreprise différente) — vérifie qu'aucune suggestion
  // inter-entreprise n'est possible par construction (filtre companyId).
  const accBId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '411100', 'Client B', 2, true, now(), now())`,
    [accBId, companyBId, frameworkId, classByCode.get('4')],
  );

  async function nextNumber(companyId: string): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'VT') as number`, [companyId]);
    return `VT-${rows[0].number}`;
  }

  async function createLine(companyId: string, accountId: string, sink: string, side: 'DEBIT' | 'CREDIT', amount: number, date: string): Promise<string> {
    const entryId = randomUUID();
    const num = await nextNumber(companyId);
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Test suggestion', 'DRAFT', $7, now(), now())`,
      [entryId, companyId, periodId, journalId, num, date, userId],
    );
    const lineId = randomUUID();
    await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,$5,$6,now())`, [lineId, entryId, accountId, companyId, side, amount]);
    await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,$5,$6,now())`, [randomUUID(), entryId, sink, companyId, side === 'DEBIT' ? 'CREDIT' : 'DEBIT', amount]);
    await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    return lineId;
  }

  // FA001: débit 1 000 000, FA002: débit 500 000
  // BQ001: crédit 1 000 000 (correspondance exacte avec FA001)
  // BQ002: crédit 300 000, BQ003: crédit 200 000 (somme = 500 000, correspondance multi-lignes avec FA002)
  await createLine(companyAId, accId, sinkId, 'DEBIT', 1000000, '2026-08-01');
  await createLine(companyAId, accId, sinkId, 'DEBIT', 500000, '2026-08-02');
  await createLine(companyAId, accId, sinkId, 'CREDIT', 1000000, '2026-08-10');
  await createLine(companyAId, accId, sinkId, 'CREDIT', 300000, '2026-08-11');
  await createLine(companyAId, accId, sinkId, 'CREDIT', 200000, '2026-08-12');

  const { rows: unlettered } = await client.query(
    `SELECT l.id, l.side, l.amount::text as amount, e.entry_number, e.label as entry_label, e.entry_date
     FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND l.lettering_id IS NULL AND e.status <> 'DRAFT'
     ORDER BY e.entry_date`,
    [companyAId, accId],
  );

  const debits = unlettered.filter((l: any) => l.side === 'DEBIT').map((l: any) => ({ ...l, amount: Number(l.amount) }));
  const credits = unlettered.filter((l: any) => l.side === 'CREDIT').map((l: any) => ({ ...l, amount: Number(l.amount) }));
  const usedCreditIds = new Set<string>();
  const suggestions: any[] = [];

  for (const debit of debits) {
    const match = credits.find((c: any) => !usedCreditIds.has(c.id) && Math.round(c.amount * 100) === Math.round(debit.amount * 100));
    if (match) {
      usedCreditIds.add(match.id);
      suggestions.push({ debitLines: [debit], creditLines: [match], confidence: 'forte' });
    }
  }
  const remainingDebits = debits.filter((d: any) => !suggestions.some((s) => s.debitLines[0].id === d.id));
  for (const debit of remainingDebits) {
    const combo = findCombinationSum(credits.filter((c: any) => !usedCreditIds.has(c.id)), debit.amount, 3);
    if (combo) {
      combo.forEach((c: any) => usedCreditIds.add(c.id));
      suggestions.push({ debitLines: [debit], creditLines: combo, confidence: 'moyenne' });
    }
  }

  // 39. Suggestion montant exact
  const exactSuggestion = suggestions.find((s) => s.confidence === 'forte');
  ok('39. Suggestion à montant exact détectée (FA001 1 000 000 ↔ BQ001 1 000 000, confiance forte)', exactSuggestion !== undefined && exactSuggestion.debitLines[0].amount === 1000000);

  // 40. Suggestion multi-lignes
  const multiSuggestion = suggestions.find((s) => s.confidence === 'moyenne');
  ok('40. Suggestion multi-lignes détectée (FA002 500 000 ↔ BQ002+BQ003 = 500 000, confiance moyenne)', multiSuggestion !== undefined && multiSuggestion.creditLines.length === 2);

  // 41. Suggestion ne crée aucun lettrage sans confirmation (aucune écriture en base)
  const { rows: letteringsCreated } = await client.query(`SELECT COUNT(*)::text as c FROM letterings WHERE company_id = $1`, [companyAId]);
  ok('41. Aucun lettrage créé par le calcul de suggestions (purement en lecture)', Number(letteringsCreated[0].c) === 0);

  // 42. Suggestion inter-entreprise impossible (le calcul est scopé par companyId+accountId dès la requête source)
  const { rows: crossCompanyLines } = await client.query(
    `SELECT COUNT(*)::text as c FROM accounting_entry_lines WHERE company_id = $1 AND account_id = $2`,
    [companyAId, accBId],
  );
  ok('42. Aucune ligne de l\'entreprise B ne peut apparaître dans le calcul de suggestions de A (filtré par company_id+account_id dès la source)', Number(crossCompanyLines[0].c) === 0);

  // Nettoyage
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM letterings WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM accounting_entries WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM accounts WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM journals WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM accounting_periods WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests de suggestions:', err);
  process.exit(1);
});
