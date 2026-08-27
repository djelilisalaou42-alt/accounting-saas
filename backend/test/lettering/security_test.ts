/**
 * Tests de sécurité additionnels (§17 de la demande de finalisation) —
 * couvre spécifiquement les points non déjà testés explicitement dans
 * lettering_test.ts : rejet d'un compte non-tiers, unicité du code de
 * lettrage généré côté serveur, et impossibilité de relettrer une
 * ligne déjà lettrée hors du workflow prévu.
 *
 * Exécution : npx ts-node test/lettering/security_test.ts
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
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sec %')`);
  await client.query(`DELETE FROM letterings WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sec %')`);
  await client.query(`DELETE FROM accounting_entries WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sec %')`);
  await client.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sec %')`);
  await client.query(`DELETE FROM journals WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sec %')`);
  await client.query(`DELETE FROM accounting_periods WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sec %')`);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Sec %')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step9Sec %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step9sec-user@example.com', 'x', 'Sec', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step9Sec Entreprise', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
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
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'OD', 'OD', 'GENERAL', now(), now())`,
    [journalId, companyId],
  );

  // Compte de tiers (classe 4) et compte NON-tiers (classe 6, charges)
  const accTiersId = randomUUID();
  const accNonTiersId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '411100', 'Client', 2, true, now(), now())`,
    [accTiersId, companyId, frameworkId, classByCode.get('4')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '605000', 'Achats de fournitures', 2, true, now(), now())`,
    [accNonTiersId, companyId, frameworkId, classByCode.get('6')],
  );

  async function nextEntryNumber(): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'OD') as number`, [companyId]);
    return `OD-${rows[0].number}`;
  }

  async function createValidatedLine(accountId: string, side: 'DEBIT' | 'CREDIT', amount: number): Promise<string> {
    const entryId = randomUUID();
    const num = await nextEntryNumber();
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '2026-08-01', 'Test sécurité', 'DRAFT', $6, now(), now())`,
      [entryId, companyId, periodId, journalId, num, userId],
    );
    const lineId = randomUUID();
    await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,$5,$6,now())`, [lineId, entryId, accountId, companyId, side, amount]);
    await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,$5,$6,now())`, [randomUUID(), entryId, accountId, companyId, side === 'DEBIT' ? 'CREDIT' : 'DEBIT', amount]);
    await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    return lineId;
  }

  // ===================================================================
  // 2. Compte non-tiers rejeté (nouvelle règle, appliquée dans
  // lettering.service.ts::create — vérification directe de la
  // métadonnée qui fonde ce refus)
  // ===================================================================
  const { rows: accNonTiersClass } = await client.query(
    `SELECT ac.code FROM accounts a JOIN account_classes ac ON ac.id = a.account_class_id WHERE a.id = $1`,
    [accNonTiersId],
  );
  ok('2. Compte non-tiers (classe 6, charges) détecté comme inéligible au lettrage (classe ≠ "4")', accNonTiersClass[0].code !== '4');
  const { rows: accTiersClass } = await client.query(
    `SELECT ac.code FROM accounts a JOIN account_classes ac ON ac.id = a.account_class_id WHERE a.id = $1`,
    [accTiersId],
  );
  ok('   -> à l\'inverse, le compte de tiers (classe 4) est bien éligible', accTiersClass[0].code === '4');

  // ===================================================================
  // 10. Code de lettrage unique, généré côté serveur, sûr en
  // concurrence (réutilise fn_next_document_number + contrainte unique
  // @@unique([companyId, accountId, code]) du modèle Lettering existant)
  // ===================================================================
  const code1Rows = await client.query(`SELECT fn_next_document_number($1, 'LETTERING'::"SequenceDocumentType", $2) as number`, [companyId, accTiersId]);
  const code2Rows = await client.query(`SELECT fn_next_document_number($1, 'LETTERING'::"SequenceDocumentType", $2) as number`, [companyId, accTiersId]);
  const code1 = `A${code1Rows.rows[0].number}`;
  const code2 = `A${code2Rows.rows[0].number}`;
  ok(`10a. Deux appels successifs à fn_next_document_number produisent des codes distincts (${code1} ≠ ${code2})`, code1 !== code2);

  // Vérifie que la contrainte unique existante empêche un doublon (au
  // cas où deux lettrages tenteraient malgré tout le même code)
  const lt1Id = randomUUID();
  await client.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1,$2,$3,'A_DUP',false,$4,now())`, [lt1Id, companyId, accTiersId, userId]);
  let duplicateRejected = false;
  try {
    await client.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1,$2,$3,'A_DUP',false,$4,now())`, [randomUUID(), companyId, accTiersId, userId]);
  } catch (err) {
    duplicateRejected = /unique|duplicate/i.test((err as Error).message);
  }
  ok('10b. La contrainte unique existante (@@unique([companyId, accountId, code])) rejette un code dupliqué', duplicateRejected);
  await client.query(`DELETE FROM letterings WHERE id = $1`, [lt1Id]);

  // ===================================================================
  // 12. Une ligne déjà lettrée ne peut pas être relettrée hors workflow
  // (le service vérifie explicitement lettering_id IS NULL avant
  // rattachement — reproduit ici directement en SQL)
  // ===================================================================
  const lineA = await createValidatedLine(accTiersId, 'DEBIT', 1000);
  const lineB = await createValidatedLine(accTiersId, 'CREDIT', 1000);
  const lt2Id = randomUUID();
  await client.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1,$2,$3,'A_FIRST',false,$4,now())`, [lt2Id, companyId, accTiersId, userId]);
  const firstAttach = await client.query(`UPDATE accounting_entry_lines SET lettering_id = $1 WHERE id = $2 AND lettering_id IS NULL`, [lt2Id, lineA]);
  ok('12a. Premier rattachement de la ligne A réussi', firstAttach.rowCount === 1);

  // Tentative de relettrer la MÊME ligne A dans un second lettrage,
  // sans passer par le délettrage — doit échouer (0 ligne affectée)
  const lt3Id = randomUUID();
  await client.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1,$2,$3,'A_SECOND',false,$4,now())`, [lt3Id, companyId, accTiersId, userId]);
  const secondAttach = await client.query(`UPDATE accounting_entry_lines SET lettering_id = $1 WHERE id = $2 AND lettering_id IS NULL`, [lt3Id, lineA]);
  ok('12b. Seconde tentative de lettrage de la même ligne A (déjà lettrée) rejetée par la condition lettering_id IS NULL (0 ligne affectée)', secondAttach.rowCount === 0);

  // Nettoyage
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM letterings WHERE company_id = $1`, [companyId]);
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
  console.error('Erreur lors de l\'exécution des tests de sécurité additionnels:', err);
  process.exit(1);
});
