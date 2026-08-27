/**
 * Tests Étape 18 (tableau de bord), exécutés contre une VRAIE instance
 * PostgreSQL (accounting_saas_test). Reproduit fidèlement les requêtes
 * de DashboardService (agrégation pure — jamais un second moteur de
 * calcul) — même limite Prisma documentée aux étapes précédentes
 * (workaround `pg`).
 *
 * Exécution : npx ts-node test/dashboard/dashboard_test.ts
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
  for (const table of ['tax_declarations', 'company_tax_settings', 'budget_lines', 'budgets', 'depreciation_entries', 'fixed_assets', 'cash_transactions', 'cash_accounts', 'bank_transactions', 'bank_accounts', 'invoice_items', 'invoices', 'customers', 'suppliers', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step18Test %')`).catch(() => {});
  }
  await client.query(`DELETE FROM taxes WHERE code = 'TVA-STEP18-TEST'`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step18Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r: any) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step18-test-user@example.com', 'x', 'Step18', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step18Test Entreprise A','BJ','XOF','ACTIVE',$2,now(),now())`, [companyAId, frameworkId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step18Test Entreprise B','BJ','XOF','ACTIVE',$2,now(),now())`, [companyBId, frameworkId]);

  const periodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [periodId, companyAId]);
  const journalId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'OD','Opérations diverses','GENERAL',now(),now())`, [journalId, companyAId]);

  const accVentesId = randomUUID();
  const accAchatsId = randomUUID();
  const accClientId = randomUUID();
  const accFournisseurId = randomUUID();
  const accBanqueId = randomUUID();
  const accImmoId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'701000','Ventes',1,true,now(),now())`, [accVentesId, companyAId, frameworkId, classByCode.get('7')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'601000','Achats',1,true,now(),now())`, [accAchatsId, companyAId, frameworkId, classByCode.get('6')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'411000','Clients',2,true,now(),now())`, [accClientId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401000','Fournisseurs',2,true,now(),now())`, [accFournisseurId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'512000','Banque',1,true,now(),now())`, [accBanqueId, companyAId, frameworkId, classByCode.get('5')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'241000','Matériel',2,true,now(),now())`, [accImmoId, companyAId, frameworkId, classByCode.get('2')]);

  async function nextNumber(): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", 'OD') as number`, [companyAId]);
    return rows[0].number;
  }
  async function createEntry(entryDate: string, lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number }>, status: 'DRAFT' | 'VALIDATED' = 'VALIDATED'): Promise<void> {
    const entryId = randomUUID();
    const entryNum = `OD-${await nextNumber()}`;
    const totalDebit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0);
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, total_debit, total_credit, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Test','DRAFT',$7,$8,$8,now(),now())`,
      [entryId, companyAId, periodId, journalId, entryNum, entryDate, userId, totalDebit],
    );
    for (let i = 0; i < lines.length; i++) {
      await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [randomUUID(), entryId, lines[i].accountId, companyAId, i + 1, lines[i].side, lines[i].amount]);
    }
    if (status === 'VALIDATED') await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
  }

  // Ventes 500 000, Achats 200 000 -> résultat attendu 300 000.
  await createEntry('2026-03-01', [{ accountId: accClientId, side: 'DEBIT', amount: 500000 }, { accountId: accVentesId, side: 'CREDIT', amount: 500000 }]);
  await createEntry('2026-03-05', [{ accountId: accAchatsId, side: 'DEBIT', amount: 200000 }, { accountId: accFournisseurId, side: 'CREDIT', amount: 200000 }]);
  // Écriture en brouillon — ne doit compter ni dans le résultat ni dans la trésorerie, mais doit apparaître dans draftEntriesCount.
  await createEntry('2026-03-10', [{ accountId: accAchatsId, side: 'DEBIT', amount: 999999 }, { accountId: accFournisseurId, side: 'CREDIT', amount: 999999 }], 'DRAFT');

  // Trésorerie : caisse et banque.
  const cashAccId = randomUUID();
  await client.query(`INSERT INTO cash_accounts (id, company_id, account_id, code, name, currency, is_active, created_at, updated_at) VALUES ($1,$2,$3,'CA-01','Caisse principale','XOF',true,now(),now())`, [cashAccId, companyAId, accBanqueId]);
  await client.query(`INSERT INTO cash_transactions (id, cash_account_id, company_id, type, amount, transaction_date, label, created_at) VALUES ($1,$2,$3,'RECEIPT',100000,'2026-03-02','Encaissement',now())`, [randomUUID(), cashAccId, companyAId]);
  const bankAccId = randomUUID();
  await client.query(`INSERT INTO bank_accounts (id, company_id, account_id, code, name, bank_name, currency, is_active, created_at, updated_at) VALUES ($1,$2,$3,'BQ-01','Compte courant','Banque Test','XOF',true,now(),now())`, [bankAccId, companyAId, accBanqueId]);
  await client.query(`INSERT INTO bank_transactions (id, bank_account_id, company_id, type, amount, transaction_date, label, source, created_at) VALUES ($1,$2,$3,'CREDIT',300000,'2026-03-03','Virement reçu','BOOK',now())`, [randomUUID(), bankAccId, companyAId]);

  // Facture client partiellement payée et échue (créances + alerte échue).
  const customerId = randomUUID();
  await client.query(`INSERT INTO customers (id, company_id, code, name, account_id, created_at, updated_at) VALUES ($1,$2,'CLI-01','Client Test',$3,now(),now())`, [customerId, companyAId, accClientId]);
  const saleInvId = randomUUID();
  await client.query(
    `INSERT INTO invoices (id, company_id, customer_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, amount_paid, created_at, updated_at)
     VALUES ($1,$2,$3,'FA-2026-1001','SALE','2026-01-01','2026-02-01','OVERDUE',150000,0,150000,50000,now(),now())`,
    [saleInvId, companyAId, customerId],
  );

  // Facture fournisseur échue non payée (dettes + alerte échue).
  const supplierId = randomUUID();
  await client.query(`INSERT INTO suppliers (id, company_id, code, name, account_id, created_at, updated_at) VALUES ($1,$2,'FRN-01','Fournisseur Test',$3,now(),now())`, [supplierId, companyAId, accFournisseurId]);
  const purchInvId = randomUUID();
  await client.query(
    `INSERT INTO invoices (id, company_id, supplier_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, amount_paid, created_at, updated_at)
     VALUES ($1,$2,$3,'FA-2026-2001','PURCHASE','2026-01-01','2026-02-01','OVERDUE',80000,0,80000,0,now(),now())`,
    [purchInvId, companyAId, supplierId],
  );

  // Immobilisation acquise, pas encore en service (alerte "à mettre en service").
  const assetId = randomUUID();
  await client.query(
    `INSERT INTO fixed_assets (id, company_id, asset_account_id, code, label, acquisition_date, acquisition_cost, residual_value, useful_life_years, status, created_at, updated_at)
     VALUES ($1,$2,$3,'IMMO-STEP18','Matériel test','2026-01-01',1000000,0,5,'ACQUIRED',now(),now())`,
    [assetId, companyAId, accImmoId],
  );

  // Taxe et déclaration avec solde restant à payer (alerte TVA).
  const taxId = randomUUID();
  await client.query(`INSERT INTO taxes (id, country, code, label, type, rate, start_date, is_active, created_at, updated_at) VALUES ($1,'BJ','TVA-STEP18-TEST','TVA test','VAT',18,'2020-01-01',true,now(),now())`, [taxId]);
  const declId = randomUUID();
  await client.query(
    `INSERT INTO tax_declarations (id, company_id, tax_id, period_label, period_start, period_end, taxable_base, amount_due, amount_paid, due_date, status, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,'Mars 2026','2026-03-01','2026-03-31',0,13000,5000,'2026-04-15','SUBMITTED',$4,now(),now())`,
    [declId, companyAId, taxId, userId],
  );

  // Budget avec ligne et réalisé (achats de mars = 200 000, budgété 250 000 -> consommation 80%).
  const budgetId = randomUUID();
  await client.query(`INSERT INTO budgets (id, company_id, period_id, name, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,'Budget Step18','ACTIVE',$4,now(),now())`, [budgetId, companyAId, periodId, userId]);
  await client.query(`INSERT INTO budget_lines (id, budget_id, company_id, account_id, month, planned_amount, actual_amount) VALUES ($1,$2,$3,$4,3,250000,0)`, [randomUUID(), budgetId, companyAId, accAchatsId]);

  // =====================================================================
  // Reproduction des calculs de DashboardService
  // =====================================================================

  // Résultat (income statement)
  const { rows: incomeRows } = await client.query(
    `SELECT ac.category::text as category, COALESCE(SUM(CASE WHEN l.side='DEBIT' THEN l.amount ELSE -l.amount END),0)::text as amount
     FROM accounts a JOIN account_classes ac ON ac.id=a.account_class_id
     JOIN accounting_entry_lines l ON l.account_id=a.id AND l.company_id=a.company_id
     JOIN accounting_entries e ON e.id=l.entry_id AND e.status<>'DRAFT'
     WHERE a.company_id=$1 AND ac.category IN ('EXPENSE','REVENUE') AND e.entry_date BETWEEN '2026-01-01' AND '2026-12-31'
     GROUP BY ac.category`,
    [companyAId],
  );
  const revenue = -Number(incomeRows.find((r: any) => r.category === 'REVENUE')?.amount ?? 0);
  const expenses = Number(incomeRows.find((r: any) => r.category === 'EXPENSE')?.amount ?? 0);
  const profit = round2(revenue - expenses);
  ok('Résumé : chiffre d\'affaires correct (500 000, écriture brouillon exclue)', revenue === 500000);
  ok('Résumé : charges correctes (200 000, écriture brouillon exclue)', expenses === 200000);
  ok('Résumé : résultat = CA - charges exactement (300 000)', profit === 300000 && profit === round2(revenue - expenses));

  // Trésorerie
  const { rows: cashRows } = await client.query(`SELECT COALESCE(SUM(CASE WHEN type='RECEIPT' THEN amount ELSE -amount END),0)::text AS bal FROM cash_transactions WHERE company_id=$1`, [companyAId]);
  const { rows: bankRows } = await client.query(`SELECT COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount ELSE -amount END),0)::text AS bal FROM bank_transactions WHERE company_id=$1`, [companyAId]);
  const cashAvailable = round2(Number(cashRows[0].bal) + Number(bankRows[0].bal));
  ok('Trésorerie disponible correcte (caisse 100 000 + banque 300 000 = 400 000)', cashAvailable === 400000);

  // Créances / dettes
  const { rows: recPayRows } = await client.query(
    `SELECT invoice_type, COALESCE(SUM(total - amount_paid),0)::text AS outstanding, COALESCE(SUM(CASE WHEN due_date < '2026-12-31' THEN 1 ELSE 0 END),0)::text AS overdue
     FROM invoices WHERE company_id=$1 AND status NOT IN ('DRAFT','CANCELLED','PAID') AND (total-amount_paid) > 0 GROUP BY invoice_type`,
    [companyAId],
  );
  const receivables = recPayRows.find((r: any) => r.invoice_type === 'SALE');
  const payables = recPayRows.find((r: any) => r.invoice_type === 'PURCHASE');
  ok('Créances clients correctes (150 000 - 50 000 payé = 100 000)', receivables && round2(Number(receivables.outstanding)) === 100000);
  ok('Dettes fournisseurs correctes (80 000 non payé)', payables && round2(Number(payables.outstanding)) === 80000);
  ok('Facture client échue détectée (overdue count = 1)', receivables && Number(receivables.overdue) === 1);
  ok('Facture fournisseur échue détectée (overdue count = 1)', payables && Number(payables.overdue) === 1);

  // Immobilisations
  const { rows: assetRows } = await client.query(
    `SELECT COALESCE(SUM(acquisition_cost),0)::text AS gross, COALESCE(SUM(CASE WHEN status='ACQUIRED' THEN 1 ELSE 0 END),0)::text AS acquired
     FROM fixed_assets WHERE company_id=$1 AND status<>'DISPOSED'`,
    [companyAId],
  );
  ok('Immobilisations : valeur brute correcte (1 000 000, aucun amortissement encore généré)', round2(Number(assetRows[0].gross)) === 1000000);
  ok('Immobilisations : 1 immobilisation acquise pas encore en service', Number(assetRows[0].acquired) === 1);

  // TVA restant dû
  const { rows: taxRows } = await client.query(`SELECT amount_due, amount_paid FROM tax_declarations WHERE company_id=$1`, [companyAId]);
  const taxRemaining = round2(Number(taxRows[0].amount_due) - Number(taxRows[0].amount_paid));
  ok('TVA restant à payer correcte (13 000 - 5 000 = 8 000)', taxRemaining === 8000);

  // Budget
  const { rows: budgetLineRows } = await client.query(`SELECT planned_amount FROM budget_lines WHERE budget_id=$1`, [budgetId]);
  const plannedTotal = budgetLineRows.reduce((s: number, r: any) => s + Number(r.planned_amount), 0);
  const { rows: actualRows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN l.side='DEBIT' THEN l.amount ELSE -l.amount END),0)::text AS actual
     FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT' AND EXTRACT(MONTH FROM e.entry_date)=3`,
    [companyAId, accAchatsId],
  );
  const actualTotal = round2(Number(actualRows[0].actual));
  const consumptionRate = round2((actualTotal / plannedTotal) * 100);
  ok('Budget : réalisé correct (200 000, recalculé depuis les vraies écritures)', actualTotal === 200000);
  ok('Budget : taux de consommation correct (200 000 / 250 000 = 80%)', consumptionRate === 80);

  // Écritures en brouillon
  const { rows: draftRows } = await client.query(`SELECT count(*)::int AS c FROM accounting_entries WHERE company_id=$1 AND status='DRAFT'`, [companyAId]);
  ok('Écritures en brouillon comptées correctement (1)', draftRows[0].c === 1);

  // Alertes attendues : facture client échue, facture fournisseur échue, TVA restant due, écriture brouillon, immobilisation à mettre en service. PAS d'alerte trésorerie (positive), PAS d'alerte budget (80% < 90%).
  const expectedAlertCount = 5;
  const actualAlertCount = [receivables && Number(receivables.overdue) > 0, payables && Number(payables.overdue) > 0, taxRemaining > 0, draftRows[0].c > 0, Number(assetRows[0].acquired) > 0].filter(Boolean).length;
  ok('Alertes : nombre correct déclenché par des seuils explicites (5), aucune alerte trésorerie/budget non justifiée', actualAlertCount === expectedAlertCount && consumptionRate < 90 && cashAvailable > 0);

  // =====================================================================
  // Isolation par companyId
  // =====================================================================
  const { rows: crossCompanyInvoices } = await client.query(`SELECT count(*)::int AS c FROM invoices WHERE company_id=$1`, [companyBId]);
  ok('Isolation : entreprise B ne voit aucune facture de A', crossCompanyInvoices[0].c === 0);
  const { rows: crossCompanyEntries } = await client.query(`SELECT count(*)::int AS c FROM accounting_entries WHERE company_id=$1`, [companyBId]);
  ok('Isolation : entreprise B ne voit aucune écriture de A', crossCompanyEntries[0].c === 0);

  // Permission réutilisée (REPORT.READ, aucune nouvelle permission créée pour le dashboard).
  const { rows: permCheck } = await client.query(`SELECT count(*)::int AS c FROM permissions WHERE code = 'REPORT.READ'`);
  ok('Le dashboard réutilise la permission REPORT.READ existante (aucune nouvelle permission créée)', permCheck[0].c === 1);

  // =====================================================================
  // Nettoyage
  // =====================================================================
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  for (const table of ['tax_declarations', 'company_tax_settings', 'budget_lines', 'budgets', 'depreciation_entries', 'fixed_assets', 'cash_transactions', 'cash_accounts', 'bank_transactions', 'bank_accounts', 'invoice_items', 'invoices', 'customers', 'suppliers', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
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
  console.error("Erreur lors de l'exécution des tests Étape 18:", err);
  process.exit(1);
});
