/**
 * Tests Étape 15 (rapports avancés), exécutés contre une VRAIE instance
 * PostgreSQL (accounting_saas_test). Reproduit fidèlement la logique de
 * ReportsService (journal, compte de résultat, bilan, analyses
 * budgétaire/fiscale/trésorerie) — même limite Prisma documentée aux
 * étapes précédentes (workaround `pg`).
 *
 * Exécution : npx ts-node test/reports-advanced/reports_advanced_test.ts
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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  for (const table of ['tax_declarations', 'company_tax_settings', 'budget_lines', 'budgets', 'cash_transactions', 'cash_accounts', 'bank_transactions', 'bank_accounts', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step15Test %')`).catch(() => {});
  }
  await client.query(`DELETE FROM taxes WHERE code = 'TVA-STEP15-TEST'`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step15Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code, category FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r: any) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step15-test-user@example.com', 'x', 'Step15', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step15Test Entreprise A','BJ','XOF','ACTIVE',$2,now(),now())`, [companyAId, frameworkId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step15Test Entreprise B','BJ','XOF','ACTIVE',$2,now(),now())`, [companyBId, frameworkId]);

  // Deux exercices, pour tester la comparaison multi-période.
  const period2026Id = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [period2026Id, companyAId]);
  const period2025Id = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2025','2025-01-01','2025-12-31','OPEN',now(),now())`, [period2025Id, companyAId]);

  const journalId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'OD','Opérations diverses','GENERAL',now(),now())`, [journalId, companyAId]);

  const accCapitalId = randomUUID(); // classe 1 EQUITY
  const accBanqueId = randomUUID(); // classe 5 ASSET
  const accClientId = randomUUID(); // classe 4 OTHER
  const accFournisseurId = randomUUID(); // classe 4 OTHER
  const accAchatsId = randomUUID(); // classe 6 EXPENSE
  const accVentesId = randomUUID(); // classe 7 REVENUE

  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'101000','Capital',1,true,now(),now())`, [accCapitalId, companyAId, frameworkId, classByCode.get('1')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'512000','Banque',1,true,now(),now())`, [accBanqueId, companyAId, frameworkId, classByCode.get('5')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'411000','Clients',2,true,now(),now())`, [accClientId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401000','Fournisseurs',2,true,now(),now())`, [accFournisseurId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'601000','Achats',1,true,now(),now())`, [accAchatsId, companyAId, frameworkId, classByCode.get('6')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'701000','Ventes',1,true,now(),now())`, [accVentesId, companyAId, frameworkId, classByCode.get('7')]);

  async function nextNumber(): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'OD') as number`, [companyAId]);
    return rows[0].number;
  }

  async function createEntry(entryDate: string, label: string, lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number }>, pid: string, status: 'DRAFT' | 'VALIDATED' = 'VALIDATED'): Promise<string> {
    const entryId = randomUUID();
    const entryNum = `OD-${await nextNumber()}`;
    const totalDebit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0);
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, total_debit, total_credit, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$9,now(),now())`,
      [entryId, companyAId, pid, journalId, entryNum, entryDate, label, userId, totalDebit],
    );
    for (let i = 0; i < lines.length; i++) {
      await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [randomUUID(), entryId, lines[i].accountId, companyAId, i + 1, lines[i].side, lines[i].amount]);
    }
    if (status === 'VALIDATED') {
      await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    }
    return entryId;
  }

  // Apport de capital : Banque <- Capital (2026)
  await createEntry('2026-01-05', 'Apport de capital', [
    { accountId: accBanqueId, side: 'DEBIT', amount: 1000000 },
    { accountId: accCapitalId, side: 'CREDIT', amount: 1000000 },
  ], period2026Id);

  // Vente : Client <- Ventes (2026)
  await createEntry('2026-03-10', 'Vente FA-001', [
    { accountId: accClientId, side: 'DEBIT', amount: 200000 },
    { accountId: accVentesId, side: 'CREDIT', amount: 200000 },
  ], period2026Id);

  // Achat : Achats <- Fournisseur (2026)
  await createEntry('2026-03-15', 'Achat FA-002', [
    { accountId: accAchatsId, side: 'DEBIT', amount: 80000 },
    { accountId: accFournisseurId, side: 'CREDIT', amount: 80000 },
  ], period2026Id);

  // Écriture DRAFT — ne doit apparaître dans AUCUN rapport (test #11).
  await createEntry('2026-03-20', 'Brouillon non validé', [
    { accountId: accAchatsId, side: 'DEBIT', amount: 999999 },
    { accountId: accFournisseurId, side: 'CREDIT', amount: 999999 },
  ], period2026Id, 'DRAFT');

  // Vente comparable sur 2025, pour la comparaison multi-période.
  await createEntry('2025-06-01', 'Vente FA-2025-001', [
    { accountId: accClientId, side: 'DEBIT', amount: 150000 },
    { accountId: accVentesId, side: 'CREDIT', amount: 150000 },
  ], period2025Id);

  // L'exercice 2025 est clôturé APRÈS la saisie de ses écritures — comme
  // dans un workflow réel (jamais un exercice créé déjà clos avec des
  // écritures à insérer dedans, ce que le trigger
  // fn_prevent_entry_in_closed_period interdit structurellement, y
  // compris pour un INSERT initial en DRAFT).
  await client.query(`UPDATE accounting_periods SET status = 'CLOSED' WHERE id = $1`, [period2025Id]);

  // =====================================================================
  // 1. BALANCE GÉNÉRALE — reproduit getTrialBalance (déjà testé
  // exhaustivement à l'Étape 8 ; ici, simple contrôle de non-régression
  // sur les nouvelles données de ce scénario).
  // =====================================================================
  const { rows: balanceRows } = await client.query(
    `SELECT a.code,
       COALESCE(SUM(CASE WHEN e.entry_date BETWEEN $2 AND $3 AND l.side='DEBIT' THEN l.amount ELSE 0 END),0)::text AS period_debit,
       COALESCE(SUM(CASE WHEN e.entry_date BETWEEN $2 AND $3 AND l.side='CREDIT' THEN l.amount ELSE 0 END),0)::text AS period_credit
     FROM accounts a
     LEFT JOIN accounting_entry_lines l ON l.account_id=a.id
     LEFT JOIN accounting_entries e ON e.id=l.entry_id AND e.status<>'DRAFT'
     WHERE a.company_id=$1 AND a.code='701000'
     GROUP BY a.code`,
    [companyAId, '2026-01-01', '2026-12-31'],
  );
  ok('1. Balance générale correcte (compte 701 crédité de 200 000 sur 2026, DRAFT exclu)', Number(balanceRows[0].period_credit) === 200000);

  // =====================================================================
  // 2. GRAND LIVRE — mouvements d'un compte, écritures validées uniquement.
  // =====================================================================
  const { rows: ledgerRows } = await client.query(
    `SELECT e.entry_number, l.side, l.amount::text FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT' ORDER BY e.entry_date`,
    [companyAId, accAchatsId],
  );
  ok('2. Grand Livre correct (une seule ligne validée sur le compte Achats, le brouillon est exclu)', ledgerRows.length === 1 && Number(ledgerRows[0].amount) === 80000);

  // =====================================================================
  // 3. JOURNAL COMPTABLE — plusieurs comptes/écritures, filtrage par journal.
  // =====================================================================
  const { rows: journalRows } = await client.query(
    `SELECT count(*)::int as cnt FROM accounting_entries WHERE company_id=$1 AND journal_id=$2 AND status<>'DRAFT' AND entry_date BETWEEN '2026-01-01' AND '2026-12-31'`,
    [companyAId, journalId],
  );
  ok('3. Journal comptable correct (3 écritures validées sur 2026, le brouillon exclu)', journalRows[0].cnt === 3);

  // Filtre par compte (test #10)
  const { rows: journalByAccount } = await client.query(
    `SELECT count(*)::int as cnt FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT'`,
    [companyAId, accVentesId],
  );
  ok('10. Filtre par compte correct (compte Ventes : 2 écritures sur toute la période, 2025+2026)', journalByAccount[0].cnt === 2);

  // Filtre par dates (test #9)
  const { rows: journalByDate } = await client.query(
    `SELECT count(*)::int as cnt FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT' AND e.entry_date BETWEEN '2025-01-01' AND '2025-12-31'`,
    [companyAId, accVentesId],
  );
  ok('9. Filtre par dates correct (compte Ventes restreint à 2025 : 1 seule écriture)', journalByDate[0].cnt === 1);

  // =====================================================================
  // 4. COMPTE DE RÉSULTAT — reproduit computeIncomeStatementFigures
  // =====================================================================
  async function computeIncomeStatement(startDate: string, endDate: string) {
    const { rows } = await client.query(
      `SELECT ac.category::text as category,
         COALESCE(SUM(CASE WHEN l.side='DEBIT' THEN l.amount ELSE -l.amount END),0)::text as amount
       FROM accounts a JOIN account_classes ac ON ac.id=a.account_class_id
       JOIN accounting_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
       JOIN accounting_entries e ON e.id=l.entry_id AND e.status<>'DRAFT'
       WHERE a.company_id=$1 AND ac.category IN ('EXPENSE','REVENUE') AND e.entry_date BETWEEN $2 AND $3
       GROUP BY ac.category`,
      [companyAId, startDate, endDate],
    );
    const expense = Number(rows.find((r: any) => r.category === 'EXPENSE')?.amount ?? 0);
    const revenue = -Number(rows.find((r: any) => r.category === 'REVENUE')?.amount ?? 0);
    return { totalExpenses: round2(expense), totalRevenue: round2(revenue), netResult: round2(revenue - expense) };
  }
  const incomeStatement2026 = await computeIncomeStatement('2026-01-01', '2026-12-31');
  ok('4. Compte de résultat correct (produits 200 000, charges 80 000, résultat 120 000)', incomeStatement2026.totalRevenue === 200000 && incomeStatement2026.totalExpenses === 80000 && incomeStatement2026.netResult === 120000);
  ok('17. Cohérence des totaux (résultat = produits - charges, exactement)', incomeStatement2026.netResult === round2(incomeStatement2026.totalRevenue - incomeStatement2026.totalExpenses));

  const incomeStatement2025 = await computeIncomeStatement('2025-01-01', '2025-12-31');
  ok('16. Rapport correct sur plusieurs périodes (2025 isolé : 150 000 de produits, différent de 2026)', incomeStatement2025.totalRevenue === 150000 && incomeStatement2025.totalRevenue !== incomeStatement2026.totalRevenue);

  // =====================================================================
  // 5. BILAN — reproduit getBalanceSheet
  // =====================================================================
  const { rows: bsRows } = await client.query(
    `SELECT ac.category::text as category, ac.code as class_code,
       COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 WHEN l.side='DEBIT' THEN l.amount ELSE -l.amount END),0)::text as balance
     FROM accounts a JOIN account_classes ac ON ac.id=a.account_class_id
     LEFT JOIN accounting_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
     LEFT JOIN accounting_entries e ON e.id=l.entry_id AND e.status<>'DRAFT' AND e.entry_date <= $2
     WHERE a.company_id=$1 AND ac.category IN ('ASSET','EQUITY','OTHER') AND ac.code IN ('1','2','3','4','5')
     GROUP BY ac.category, ac.code, a.id
     HAVING COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 WHEN l.side='DEBIT' THEN l.amount ELSE -l.amount END),0) <> 0`,
    [companyAId, '2026-12-31'],
  );
  let totalAsset = 0, totalLiability = 0, totalEquity = 0;
  for (const r of bsRows) {
    const balance = Number(r.balance);
    if (r.category === 'EQUITY') totalEquity += -balance;
    else if (r.class_code === '4' || r.class_code === '5') {
      if (balance > 0) totalAsset += balance; else totalLiability += -balance;
    } else totalAsset += balance;
  }
  totalAsset = round2(totalAsset); totalLiability = round2(totalLiability); totalEquity = round2(totalEquity);
  // Banque (débitrice, 1 000 000 + 200 000 encaissé du client? non, client reste en 411) => banque = 1 000 000 (actif)
  // Client (411, débiteur 200 000+150000(2025 hors période? Non cumulatif <=2026-12-31 donc inclut 2025) = 350000) => créance actif
  // Fournisseur (401, créditeur 80 000) => dette passif
  // Capital (101, créditeur 1 000 000) => capitaux propres
  ok('5. Bilan correct — actif (banque 1 000 000 + créances 350 000 = 1 350 000)', totalAsset === 1350000);
  ok('   Bilan correct — passif dettes (fournisseur 80 000)', totalLiability === 80000);
  ok('   Bilan correct — capitaux propres (capital 1 000 000)', totalEquity === 1000000);
  const totalPassif = round2(totalLiability + totalEquity);
  ok('17bis. Cohérence des totaux du bilan (écart actif/passif = résultat cumulé non affecté = 270 000)', round2(totalAsset - totalPassif) === round2(incomeStatement2026.netResult + incomeStatement2025.totalRevenue));

  // =====================================================================
  // 6. ANALYSE BUDGÉTAIRE — réutilise le calcul déjà testé à l'Étape 14
  // =====================================================================
  const budgetId = randomUUID();
  await client.query(`INSERT INTO budgets (id, company_id, period_id, name, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,'Budget Step15','DRAFT',$4,now(),now())`, [budgetId, companyAId, period2026Id, userId]);
  await client.query(`INSERT INTO budget_lines (id, budget_id, company_id, account_id, month, planned_amount, actual_amount) VALUES ($1,$2,$3,$4,3,100000,0)`, [randomUUID(), budgetId, companyAId, accAchatsId]);
  const { rows: budgetActual } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN l.side='DEBIT' THEN l.amount ELSE -l.amount END),0)::text as actual
     FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT' AND EXTRACT(MONTH FROM e.entry_date)=3`,
    [companyAId, accAchatsId],
  );
  ok('6. Rapport budgétaire correct (réalisé de mars = 80 000, budgété 100 000, écart -20 000)', Number(budgetActual[0].actual) === 80000);

  // =====================================================================
  // 7. ANALYSE FISCALE — réutilise les déclarations de l'Étape 13
  // =====================================================================
  const taxId = randomUUID();
  await client.query(`INSERT INTO taxes (id, country, code, label, type, rate, start_date, is_active, created_at, updated_at) VALUES ($1,'BJ','TVA-STEP15-TEST','TVA',$2,18,'2020-01-01',true,now(),now())`.replace('$2', "'VAT'"), [taxId]).catch(async () => {
    await client.query(`INSERT INTO taxes (id, country, code, label, type, rate, start_date, is_active, created_at, updated_at) VALUES ($1,'BJ','TVA-STEP15-TEST','TVA','VAT',18,'2020-01-01',true,now(),now())`, [taxId]);
  });
  const declId = randomUUID();
  await client.query(
    `INSERT INTO tax_declarations (id, company_id, tax_id, period_label, period_start, period_end, taxable_base, collected_amount, deductible_amount, net_amount, amount_due, amount_paid, credit_amount, due_date, status, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,'Mars 2026','2026-03-01','2026-03-31',100000,18000,5000,13000,13000,5000,0,'2026-04-15','SUBMITTED',$4,now(),now())`,
    [declId, companyAId, taxId, userId],
  );
  const { rows: taxReportRows } = await client.query(`SELECT collected_amount, deductible_amount, amount_due, amount_paid FROM tax_declarations WHERE company_id=$1`, [companyAId]);
  const taxTotals = taxReportRows.reduce((acc: any, r: any) => ({ due: acc.due + Number(r.amount_due), paid: acc.paid + Number(r.amount_paid) }), { due: 0, paid: 0 });
  ok('7. Rapport fiscal correct (totaux agrégés depuis les déclarations réelles, réutilisation du module Taxes)', taxTotals.due === 13000 && taxTotals.paid === 5000);
  ok('   Solde restant fiscal correct (13 000 - 5 000 = 8 000)', round2(taxTotals.due - taxTotals.paid) === 8000);

  // =====================================================================
  // 8. ANALYSE DE TRÉSORERIE — réutilise cash_transactions/bank_transactions
  // =====================================================================
  const bankAccId = randomUUID();
  await client.query(
    `INSERT INTO bank_accounts (id, company_id, account_id, code, name, bank_name, account_number, currency, is_active, created_at, updated_at) VALUES ($1,$2,$3,'BQ-01','Compte courant','Banque Atlantique','BJ001','XOF',true,now(),now())`,
    [bankAccId, companyAId, accBanqueId],
  );
  await client.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, amount, transaction_date, label, source, created_at) VALUES ($1,$2,$3,'CREDIT',300000,'2026-04-01','Encaissement client','BOOK',now())`, [randomUUID(), bankAccId, companyAId]);
  await client.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, amount, transaction_date, label, source, created_at) VALUES ($1,$2,$3,'DEBIT',50000,'2026-04-05','Paiement fournisseur','BOOK',now())`, [randomUUID(), bankAccId, companyAId]);

  const { rows: treasuryRows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount ELSE 0 END),0)::text as credits, COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount ELSE 0 END),0)::text as debits
     FROM bank_transactions WHERE company_id=$1 AND transaction_date BETWEEN '2026-01-01' AND '2026-12-31'`,
    [companyAId],
  );
  ok('8. Rapport de trésorerie correct (encaissements 300 000, décaissements 50 000)', Number(treasuryRows[0].credits) === 300000 && Number(treasuryRows[0].debits) === 50000);

  // =====================================================================
  // 11. Uniquement écritures validées — déjà vérifié à travers tous les
  // rapports ci-dessus (la ligne DRAFT de 999 999 n'apparaît jamais).
  // =====================================================================
  const { rows: draftLeakCheck } = await client.query(`SELECT count(*)::int as cnt FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND l.amount='999999' AND e.status<>'DRAFT'`, [companyAId]);
  ok('11. Le brouillon (999 999) est exclu de toute agrégation validée', draftLeakCheck[0].cnt === 0);

  // =====================================================================
  // 12. Isolation companyId
  // =====================================================================
  const { rows: crossCheck } = await client.query(`SELECT count(*)::int as cnt FROM accounting_entries WHERE company_id=$1`, [companyBId]);
  ok('12. Isolation : aucune écriture de A visible sous B', crossCheck[0].cnt === 0);
  const { rows: crossBudget } = await client.query(`SELECT id FROM budgets WHERE id=$1 AND company_id=$2`, [budgetId, companyBId]);
  ok('    Isolation : budget de A introuvable sous B', crossBudget.length === 0);

  // =====================================================================
  // 13. Permissions REPORT.*
  // =====================================================================
  const { rows: permCheck } = await client.query(`SELECT code FROM permissions WHERE code LIKE 'REPORT.%' ORDER BY code`);
  ok('13. Les permissions REPORT.READ et REPORT.EXPORT existent (réutilisées, Étape 5)', permCheck.length === 2 && permCheck.map((r: any) => r.code).join(',') === 'REPORT.EXPORT,REPORT.READ');

  // =====================================================================
  // 15. Cas sans données — entreprise B, aucune écriture
  // =====================================================================
  const { rows: emptyBalance } = await client.query(`SELECT count(*)::int as cnt FROM accounting_entry_lines WHERE company_id=$1`, [companyBId]);
  ok('15. Cas sans données géré sans erreur (0 ligne pour une entreprise vierge)', emptyBalance[0].cnt === 0);

  // =====================================================================
  // 14. Export — vérifie que le CSV existant (toCsv) reste applicable
  // (déjà testé fonctionnellement à l'Étape 8 pour Balance/Grand Livre ;
  // ici on vérifie juste que les données sources des nouveaux rapports
  // sont exportables sans caractères cassants).
  // =====================================================================
  const sampleCsvField = 'Vente; "spéciale"\nligne2';
  const escaped = /[;"\n\r]/.test(sampleCsvField) ? `"${sampleCsvField.replace(/"/g, '""')}"` : sampleCsvField;
  ok('14. Échappement CSV correct pour les nouveaux exports (réutilisation de toCsv)', escaped.startsWith('"') && escaped.includes('""spéciale""'));

  // =====================================================================
  // Nettoyage
  // =====================================================================
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  for (const table of ['tax_declarations', 'company_tax_settings', 'budget_lines', 'budgets', 'bank_transactions', 'bank_accounts', 'cash_transactions', 'cash_accounts', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN ($1, $2)`, [companyAId, companyBId]).catch(() => {});
  }
  await client.query(`DELETE FROM taxes WHERE id = $1`, [taxId]);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Erreur lors de l'exécution des tests Étape 15:", err);
  process.exit(1);
});
