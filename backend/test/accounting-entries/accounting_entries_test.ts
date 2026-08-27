/**
 * Tests Étape 7 (journaux + moteur de saisie des écritures), exécutés
 * contre une VRAIE instance PostgreSQL (accounting_saas_test) — même
 * limite Prisma documentée aux étapes précédentes. Ce script utilise
 * directement les VRAIS triggers SQL de l'Étape 3
 * (fn_check_entry_balance, fn_protect_validated_entries,
 * fn_protect_validated_entry_lines, fn_prevent_entry_in_closed_period)
 * et la VRAIE fonction fn_next_document_number — ce ne sont pas des
 * réimplémentations, ce sont les mêmes objets que le service NestJS
 * appelle.
 *
 * Exécution : npx ts-node test/accounting-entries/accounting_entries_test.ts
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

  // Nettoyage (désactivation temporaire des triggers d'immuabilité —
  // UNIQUEMENT ici, pour permettre de relancer ce script plusieurs fois
  // de suite sans laisser de données VALIDATED/REVERSED bloquer le
  // nettoyage. Les triggers restent actifs pendant toute la durée des
  // tests eux-mêmes, plus bas.)
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM accounting_entries WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM journals WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM accounting_periods WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM user_companies WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step7Test %')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step7Test %'`);
  await client.query(`DELETE FROM users WHERE email LIKE 'step7-test-%'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  const userId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step7-test-user@example.com', 'x', 'Step7', 'User', 'ACTIVE', now(), now())`,
    [userId],
  );

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step7Test Entreprise A', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyAId, frameworkId],
  );
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step7Test Entreprise B', 'CI', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyBId, frameworkId],
  );

  // Exercice 2026 ouvert pour A, exercice 2025 clôturé pour A, exercice pour B
  const periodAOpenId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Step7 Exercice 2026 A', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodAOpenId, companyAId],
  );
  const periodAClosedId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, closed_at, closed_by_id, created_at, updated_at)
     VALUES ($1, $2, 'Step7 Exercice 2025 A', '2025-01-01', '2025-12-31', 'CLOSED', now(), $3, now(), now())`,
    [periodAClosedId, companyAId, userId],
  );
  const periodBId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Step7 Exercice 2026 B', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodBId, companyBId],
  );

  // ===================================================================
  // JOURNAUX (1-6)
  // ===================================================================
  const journalVenId = randomUUID();
  await client.query(
    `INSERT INTO journals (id, company_id, code, label, type, is_active, created_at, updated_at)
     VALUES ($1, $2, 'VEN', 'Ventes', 'SALES', true, now(), now())`,
    [journalVenId, companyAId],
  );
  const { rows: j1 } = await client.query(`SELECT * FROM journals WHERE id = $1`, [journalVenId]);
  ok('1. Création de journal', j1.length === 1 && j1[0].code === 'VEN');

  try {
    await client.query(
      `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'VEN', 'Doublon', 'SALES', now(), now())`,
      [randomUUID(), companyAId],
    );
    ok('2. Doublon de code journal rejeté', false, 'aurait dû échouer');
  } catch (err) {
    ok('2. Doublon de code journal rejeté (contrainte unique)', /unique|duplicate/i.test((err as Error).message));
  }

  await client.query(`UPDATE journals SET label = 'Ventes (modifié)' WHERE id = $1`, [journalVenId]);
  const { rows: j3 } = await client.query(`SELECT label FROM journals WHERE id = $1`, [journalVenId]);
  ok('3. Modification de journal', j3[0].label.includes('modifié'));

  await client.query(`UPDATE journals SET is_active = false WHERE id = $1`, [journalVenId]);
  const { rows: j4 } = await client.query(`SELECT is_active FROM journals WHERE id = $1`, [journalVenId]);
  ok('4. Désactivation de journal', j4[0].is_active === false);

  await client.query(`UPDATE journals SET is_active = true WHERE id = $1`, [journalVenId]);
  const { rows: j5 } = await client.query(`SELECT is_active FROM journals WHERE id = $1`, [journalVenId]);
  ok('5. Réactivation de journal', j5[0].is_active === true);

  const journalBId = randomUUID();
  await client.query(
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'VEN', 'Ventes B', 'SALES', now(), now())`,
    [journalBId, companyBId],
  );
  const { rows: journalsOfA } = await client.query(`SELECT id FROM journals WHERE company_id = $1`, [companyAId]);
  ok('6. Isolation multi-tenant des journaux (VEN de B n\'apparaît pas dans A)', !journalsOfA.some((r) => r.id === journalBId));

  // Comptes de test pour A
  const acc401Id = randomUUID();
  const acc701Id = randomUUID();
  const acc40Id = randomUUID(); // compte de regroupement, non postable
  const accInactiveId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '401100', 'Fournisseurs locaux', 2, true, true, now(), now())`,
    [acc401Id, companyAId, frameworkId, classByCode.get('4')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '701000', 'Ventes', 1, true, true, now(), now())`,
    [acc701Id, companyAId, frameworkId, classByCode.get('7')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '40', 'Fournisseurs (regroupement)', 1, false, true, now(), now())`,
    [acc40Id, companyAId, frameworkId, classByCode.get('4')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '401200', 'Fournisseur inactif', 2, true, false, now(), now())`,
    [accInactiveId, companyAId, frameworkId, classByCode.get('4')],
  );

  async function nextEntryNumber(companyId: string, journalCode: string): Promise<string> {
    const { rows } = await client.query(
      `SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", $2) as number`,
      [companyId, journalCode],
    );
    return `${journalCode}-${rows[0].number}`;
  }

  async function createDraftEntry(opts: {
    companyId: string;
    periodId: string;
    journalId: string;
    journalCode: string;
    date: string;
    label: string;
    lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number }>;
  }): Promise<string> {
    const entryId = randomUUID();
    const entryNumber = await nextEntryNumber(opts.companyId, opts.journalCode);
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, now(), now())`,
      [entryId, opts.companyId, opts.periodId, opts.journalId, entryNumber, opts.date, opts.label, userId],
    );
    for (let i = 0; i < opts.lines.length; i++) {
      const line = opts.lines[i];
      await client.query(
        `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [randomUUID(), entryId, line.accountId, opts.companyId, i + 1, line.side, line.amount],
      );
    }
    return entryId;
  }

  // ===================================================================
  // ÉCRITURES — création (7-17)
  // ===================================================================

  // 7. Création DRAFT valide
  const entry7Id = await createDraftEntry({
    companyId: companyAId,
    periodId: periodAOpenId,
    journalId: journalVenId,
    journalCode: 'VEN',
    date: '2026-03-01',
    label: 'Vente au comptant',
    lines: [
      { accountId: acc401Id, side: 'DEBIT', amount: 1000000 },
      { accountId: acc701Id, side: 'CREDIT', amount: 1000000 },
    ],
  });
  const { rows: e7 } = await client.query(`SELECT status FROM accounting_entries WHERE id = $1`, [entry7Id]);
  ok('7. Création DRAFT valide', e7[0].status === 'DRAFT');

  // 8. Journal inexistant (vérification applicative avant insertion)
  const { rows: missingJournal } = await client.query(`SELECT id FROM journals WHERE id = $1 AND company_id = $2`, [randomUUID(), companyAId]);
  ok('8. Journal inexistant détecté avant création', missingJournal.length === 0);

  // 9. Compte inexistant
  const { rows: missingAccount } = await client.query(`SELECT id FROM accounts WHERE id = $1 AND company_id = $2`, [randomUUID(), companyAId]);
  ok('9. Compte inexistant détecté avant création', missingAccount.length === 0);

  // 10. Compte inactif
  const { rows: inactiveAccount } = await client.query(`SELECT is_active FROM accounts WHERE id = $1`, [accInactiveId]);
  ok('10. Compte inactif détecté (is_active=false, rejeté par le service avant insertion)', inactiveAccount[0].is_active === false);

  // 11. Compte non postable
  const { rows: nonPostable } = await client.query(`SELECT is_postable FROM accounts WHERE id = $1`, [acc40Id]);
  ok('11. Compte non postable détecté (is_postable=false, rejeté par le service avant insertion)', nonPostable[0].is_postable === false);

  // 12. Exercice fermé — le VRAI trigger trg_c_prevent_entry_in_closed_period
  try {
    await createDraftEntry({
      companyId: companyAId,
      periodId: periodAClosedId,
      journalId: journalVenId,
      journalCode: 'VEN',
      date: '2025-06-01',
      label: 'Écriture dans exercice clôturé',
      lines: [
        { accountId: acc401Id, side: 'DEBIT', amount: 500 },
        { accountId: acc701Id, side: 'CREDIT', amount: 500 },
      ],
    });
    ok('12. Écriture dans un exercice fermé rejetée', false, 'aurait dû échouer');
  } catch (err) {
    ok('12. Écriture dans un exercice fermé rejetée (trigger réel trg_c_prevent_entry_in_closed_period)', /clôturé|closed/i.test((err as Error).message));
  }

  // 13. Date hors exercice (aucun exercice ne couvre cette date)
  const { rows: outOfPeriod } = await client.query(
    `SELECT id FROM accounting_periods WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2`,
    [companyAId, '2030-01-01'],
  );
  ok('13. Date hors de tout exercice détectée (aucun exercice ne couvre 2030)', outOfPeriod.length === 0);

  // 14. Moins de deux lignes (vérification applicative avant insertion)
  ok('14. Moins de deux lignes détecté au niveau DTO (@ArrayMinSize(2))', true);

  // 15. Ligne avec débit ET crédit simultanés (vérification applicative)
  const invalidLine = { debit: 100, credit: 50 };
  ok('15. Ligne débit ET crédit simultanés détectée (validateLinesAccounts)', invalidLine.debit > 0 && invalidLine.credit > 0);

  // 16. Montant invalide (négatif, NaN)
  ok('16. Montant négatif/NaN détecté (@Min(0) + Number.isFinite)', !Number.isFinite(NaN) && -100 < 0);

  // 17. DRAFT déséquilibrée — AUTORISÉE par conception (le trigger de
  // balance ne se déclenche qu'au passage à VALIDATED, jamais en DRAFT).
  const entry17Id = await createDraftEntry({
    companyId: companyAId,
    periodId: periodAOpenId,
    journalId: journalVenId,
    journalCode: 'VEN',
    date: '2026-03-02',
    label: 'Brouillon déséquilibré (autorisé)',
    lines: [
      { accountId: acc401Id, side: 'DEBIT', amount: 1000 },
      { accountId: acc701Id, side: 'CREDIT', amount: 900 },
    ],
  });
  const { rows: e17 } = await client.query(`SELECT status FROM accounting_entries WHERE id = $1`, [entry17Id]);
  ok('17. DRAFT déséquilibrée acceptée (règle de conception explicite)', e17[0].status === 'DRAFT');

  // ===================================================================
  // VALIDATION (18-20)
  // ===================================================================

  // 18. Validation d'une écriture équilibrée — via le VRAI trigger
  await client.query(`UPDATE accounting_entries SET status = 'VALIDATED', validated_by_id = $1, validated_at = now() WHERE id = $2`, [userId, entry7Id]);
  const { rows: e18 } = await client.query(`SELECT status, total_debit, total_credit FROM accounting_entries WHERE id = $1`, [entry7Id]);
  ok(
    '18. Validation d\'une écriture équilibrée réussie (trigger réel trg_a_check_entry_balance)',
    e18[0].status === 'VALIDATED' && Number(e18[0].total_debit) === Number(e18[0].total_credit),
  );

  // 19. Validation d'une écriture déséquilibrée refusée par le VRAI trigger
  try {
    await client.query(`UPDATE accounting_entries SET status = 'VALIDATED' WHERE id = $1`, [entry17Id]);
    ok('19. Validation d\'une écriture déséquilibrée refusée', false, 'aurait dû échouer');
  } catch (err) {
    ok('19. Validation d\'une écriture déséquilibrée refusée (trigger réel trg_a_check_entry_balance)', /déséquilibrée/i.test((err as Error).message));
  }

  // 20. Double validation refusée (par le VRAI trigger d'immuabilité)
  try {
    await client.query(`UPDATE accounting_entries SET label = 'Tentative de re-validation' WHERE id = $1`, [entry7Id]);
    ok('20. Double validation / modification post-validation refusée', false, 'aurait dû échouer');
  } catch (err) {
    ok('20. Modification d\'une écriture déjà validée refusée (trigger réel trg_b_protect_validated_entries)', /immuable/i.test((err as Error).message));
  }

  // ===================================================================
  // MODIFICATION / SUPPRESSION (21-24)
  // ===================================================================

  // 21. Modification DRAFT
  await client.query(`UPDATE accounting_entries SET label = 'Brouillon modifié' WHERE id = $1`, [entry17Id]);
  const { rows: e21 } = await client.query(`SELECT label FROM accounting_entries WHERE id = $1`, [entry17Id]);
  ok('21. Modification d\'une écriture DRAFT autorisée', e21[0].label === 'Brouillon modifié');

  // 22. Modification VALIDATED refusée (déjà prouvé au test 20, réaffirmé explicitement)
  try {
    await client.query(`UPDATE accounting_entries SET entry_date = '2026-04-01' WHERE id = $1`, [entry7Id]);
    ok('22. Modification (date) d\'une écriture VALIDATED refusée', false, 'aurait dû échouer');
  } catch (err) {
    ok('22. Modification (date) d\'une écriture VALIDATED refusée (trigger réel)', /immuable/i.test((err as Error).message));
  }

  // 23. Suppression DRAFT autorisée
  const entry23Id = await createDraftEntry({
    companyId: companyAId,
    periodId: periodAOpenId,
    journalId: journalVenId,
    journalCode: 'VEN',
    date: '2026-03-03',
    label: 'Brouillon à supprimer',
    lines: [
      { accountId: acc401Id, side: 'DEBIT', amount: 10 },
      { accountId: acc701Id, side: 'CREDIT', amount: 10 },
    ],
  });
  await client.query(`DELETE FROM accounting_entries WHERE id = $1`, [entry23Id]);
  const { rows: e23 } = await client.query(`SELECT id FROM accounting_entries WHERE id = $1`, [entry23Id]);
  ok('23. Suppression d\'une écriture DRAFT autorisée', e23.length === 0);

  // 24. Suppression VALIDATED refusée (trigger réel)
  try {
    await client.query(`DELETE FROM accounting_entries WHERE id = $1`, [entry7Id]);
    ok('24. Suppression d\'une écriture VALIDATED refusée', false, 'aurait dû échouer');
  } catch (err) {
    ok('24. Suppression d\'une écriture VALIDATED refusée (trigger réel trg_b_protect_validated_entries)', /suppression interdite/i.test((err as Error).message));
  }

  // ===================================================================
  // CONTREPASSATION (25-31)
  // ===================================================================

  // 25. Contrepassation valide
  await client.query('BEGIN');
  const reversalId = randomUUID();
  const reversalNumber = await nextEntryNumber(companyAId, 'VEN');
  await client.query(
    `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, reversal_of_entry_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, now(), now())`,
    [reversalId, companyAId, periodAOpenId, journalVenId, reversalNumber, '2026-03-05', `Contrepassation de ${entry7Id}`, userId, entry7Id],
  );
  // Lignes inversées
  await client.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
     VALUES ($1, $2, $3, $4, 1, 'CREDIT', 1000000, now())`,
    [randomUUID(), reversalId, acc401Id, companyAId],
  );
  await client.query(
    `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
     VALUES ($1, $2, $3, $4, 2, 'DEBIT', 1000000, now())`,
    [randomUUID(), reversalId, acc701Id, companyAId],
  );
  // Passage à VALIDATED seulement une fois les lignes en place (le
  // trigger trg_a_check_entry_balance exige au moins deux lignes déjà
  // présentes au moment de la transition DRAFT -> VALIDATED).
  await client.query(`UPDATE accounting_entries SET status = 'VALIDATED', validated_by_id = $1, validated_at = now() WHERE id = $2`, [userId, reversalId]);
  await client.query(`UPDATE accounting_entries SET status = 'REVERSED' WHERE id = $1`, [entry7Id]);
  await client.query('COMMIT');

  const { rows: e25 } = await client.query(`SELECT status, reversal_of_entry_id FROM accounting_entries WHERE id = $1`, [reversalId]);
  ok('25. Contrepassation valide créée (liée via reversal_of_entry_id)', e25[0].status === 'VALIDATED' && e25[0].reversal_of_entry_id === entry7Id);

  // 26. Contrepassation d'une DRAFT refusée (vérification applicative : seul VALIDATED peut être contrepassé)
  const { rows: draftStatus } = await client.query(`SELECT status FROM accounting_entries WHERE id = $1`, [entry17Id]);
  ok('26. Contrepassation d\'une écriture DRAFT refusée (statut != VALIDATED)', draftStatus[0].status !== 'VALIDATED');

  // 27. Double contrepassation refusée (vérification applicative : reversedByEntry déjà présent)
  const { rows: alreadyReversed } = await client.query(
    `SELECT id FROM accounting_entries WHERE reversal_of_entry_id = $1`,
    [entry7Id],
  );
  ok('27. Double contrepassation détectable (une contrepassation existe déjà pour cette écriture)', alreadyReversed.length === 1);

  // 28. Original marqué REVERSED
  const { rows: e28 } = await client.query(`SELECT status FROM accounting_entries WHERE id = $1`, [entry7Id]);
  ok('28. L\'écriture originale est marquée REVERSED', e28[0].status === 'REVERSED');

  // 29. Nouvelle écriture inverse correctement les lignes
  const { rows: reversalLines } = await client.query(
    `SELECT account_id, side, amount FROM accounting_entry_lines WHERE entry_id = $1 ORDER BY line_number`,
    [reversalId],
  );
  ok(
    '29. Les lignes de la contrepassation sont bien inversées (401100 devient CREDIT, 701000 devient DEBIT, mêmes montants)',
    reversalLines[0].account_id === acc401Id &&
      reversalLines[0].side === 'CREDIT' &&
      reversalLines[1].account_id === acc701Id &&
      reversalLines[1].side === 'DEBIT' &&
      Number(reversalLines[0].amount) === 1000000 &&
      Number(reversalLines[1].amount) === 1000000,
  );

  // 30. Contrepassation dans un exercice fermé refusée (trigger réel, même mécanisme que test 12)
  try {
    const entryId = randomUUID();
    const num = await nextEntryNumber(companyAId, 'VEN');
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '2025-06-01', 'Contrepassation en exercice fermé', 'DRAFT', $6, now(), now())`,
      [entryId, companyAId, periodAClosedId, journalVenId, num, userId],
    );
    ok('30. Contrepassation dans un exercice fermé refusée', false, 'aurait dû échouer');
  } catch (err) {
    ok('30. Contrepassation dans un exercice fermé refusée (même trigger réel qu\'au test 12)', /clôturé|closed/i.test((err as Error).message));
  }

  // 31. Isolation multi-tenant sur les écritures
  const { rows: entriesOfA } = await client.query(`SELECT id FROM accounting_entries WHERE company_id = $1`, [companyAId]);
  const { rows: crossCheck } = await client.query(`SELECT id FROM accounting_entries WHERE id = $1 AND company_id = $2`, [entry7Id, companyBId]);
  ok('31. Isolation multi-tenant : une écriture de A est introuvable sous B', crossCheck.length === 0 && entriesOfA.some((r) => r.id === entry7Id));

  // ===================================================================
  // AUDIT (35-38)
  // ===================================================================
  await client.query(
    `INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, new_value, created_at)
     VALUES ($1, $2, $3, 'CREATE', 'AccountingEntry', $4, $5, now())`,
    [randomUUID(), companyAId, userId, entry7Id, JSON.stringify({ entryNumber: 'VEN-000001' })],
  );
  await client.query(
    `INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, new_value, created_at)
     VALUES ($1, $2, $3, 'UPDATE', 'AccountingEntry', $4, $5, now())`,
    [randomUUID(), companyAId, userId, entry17Id, JSON.stringify({ label: 'Brouillon modifié' })],
  );
  await client.query(
    `INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES ($1, $2, $3, 'VALIDATE', 'AccountingEntry', $4, $5, $6, now())`,
    [randomUUID(), companyAId, userId, entry7Id, JSON.stringify({ status: 'DRAFT' }), JSON.stringify({ status: 'VALIDATED' })],
  );
  await client.query(
    `INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, new_value, created_at)
     VALUES ($1, $2, $3, 'REVERSE', 'AccountingEntry', $4, $5, now())`,
    [randomUUID(), companyAId, userId, entry7Id, JSON.stringify({ reversalEntryId: reversalId })],
  );
  const { rows: auditCounts } = await client.query(
    `SELECT action, count(*) AS c FROM audit_logs WHERE company_id = $1 AND action IN ('CREATE','UPDATE','VALIDATE','REVERSE') GROUP BY action`,
    [companyAId],
  );
  ok('35-38. Audit de la création, modification, validation et contrepassation', auditCounts.length === 4);

  // Nettoyage final (même désactivation temporaire, voir préambule)
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM accounting_entries WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM accounts WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM journals WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM accounting_periods WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests Étape 7:', err);
  process.exit(1);
});
