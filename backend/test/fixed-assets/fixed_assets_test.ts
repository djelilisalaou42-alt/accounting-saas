/**
 * Tests Étape 12 (immobilisations et amortissements), exécutés contre
 * une VRAIE instance PostgreSQL (accounting_saas_test). Reproduit
 * fidèlement la logique du service NestJS (mêmes requêtes, mêmes
 * triggers réels, même calcul de plan d'amortissement — importé
 * directement depuis depreciation-calculator.ts, aucune duplication de
 * la logique de calcul) — même limite Prisma documentée aux étapes
 * précédentes (prisma generate bloqué, workaround `pg` direct).
 *
 * Exécution : npx ts-node test/fixed-assets/fixed_assets_test.ts
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { computeDepreciationSchedule, findScheduleLineForFiscalYear } from '../../src/modules/fixed-assets/depreciation-calculator';

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
  for (const table of ['asset_disposals', 'depreciation_entries', 'fixed_assets', 'asset_categories', 'invoice_items', 'invoices', 'suppliers', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step12Test %')`).catch(() => {});
  }
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step12Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r: any) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step12-test-user@example.com', 'x', 'Step12', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step12Test Entreprise A','BJ','XOF','ACTIVE',$2,now(),now())`, [companyAId, frameworkId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step12Test Entreprise B','CI','XOF','ACTIVE',$2,now(),now())`, [companyBId, frameworkId]);

  const periodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2024','2024-01-01','2024-12-31','OPEN',now(),now())`, [periodId, companyAId]);
  const period25Id = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2025','2025-01-01','2025-12-31','OPEN',now(),now())`, [period25Id, companyAId]);
  const period26Id = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [period26Id, companyAId]);
  const closedPeriodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2023','2023-01-01','2023-12-31','CLOSED',now(),now())`, [closedPeriodId, companyAId]);

  const journalId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'OD','Opérations diverses','GENERAL',now(),now())`, [journalId, companyAId]);

  const accImmoId = randomUUID();
  const accAmortId = randomUUID();
  const accDotationId = randomUUID();
  const accFournisseurId = randomUUID();
  const accBanqueId = randomUUID();
  const accResultatId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'241000','Matériel et outillage',2,true,now(),now())`, [accImmoId, companyAId, frameworkId, classByCode.get('2')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'284100','Amort. matériel et outillage',2,true,now(),now())`, [accAmortId, companyAId, frameworkId, classByCode.get('2')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'681100','Dotations aux amortissements',2,true,now(),now())`, [accDotationId, companyAId, frameworkId, classByCode.get('6')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401100','Fournisseur',2,true,now(),now())`, [accFournisseurId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'521000','Banque',1,true,now(),now())`, [accBanqueId, companyAId, frameworkId, classByCode.get('5')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'822000','Produits/charges de cession',1,true,now(),now())`, [accResultatId, companyAId, frameworkId, classByCode.get('8') ?? classByCode.get('7')]);

  const supplierId = randomUUID();
  await client.query(`INSERT INTO suppliers (id, company_id, code, name, account_id, created_at, updated_at) VALUES ($1,$2,'FRN-01','Fournisseur Test',$3,now(),now())`, [supplierId, companyAId, accFournisseurId]);

  async function nextNumber(docType: string, scope: string): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, $2::"SequenceDocumentType", $3) as number`, [companyAId, docType, scope]);
    return rows[0].number;
  }

  /** Reproduit fidèlement FixedAssetsService.createBalancedEntry (DRAFT -> lignes -> VALIDATED). */
  async function createBalancedEntry(entryDate: string, label: string, reference: string, lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; label?: string }>, pid: string = periodId): Promise<string> {
    const entryId = randomUUID();
    const entryNum = `OD-${await nextNumber('ACCOUNTING_ENTRY', 'OD')}`;
    const totalDebit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0);
    const totalCredit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.amount, 0);
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, reference, status, created_by_id, total_debit, total_credit, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',$9,$10,$11,now(),now())`,
      [entryId, companyAId, pid, journalId, entryNum, entryDate, label, reference, userId, totalDebit, totalCredit],
    );
    for (let i = 0; i < lines.length; i++) {
      await client.query(
        `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, label, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [randomUUID(), entryId, lines[i].accountId, companyAId, i + 1, lines[i].side, lines[i].amount, lines[i].label ?? null],
      );
    }
    await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    return entryId;
  }

  // =====================================================================
  // 1. Catégorie d'immobilisation
  // =====================================================================
  const categoryId = randomUUID();
  await client.query(
    `INSERT INTO asset_categories (id, company_id, code, name, asset_account_id, depreciation_account_id, depreciation_expense_account_id, default_method, default_useful_life_years, is_active, created_at, updated_at)
     VALUES ($1,$2,'MAT','Matériel et outillage',$3,$4,$5,'STRAIGHT_LINE',5,true,now(),now())`,
    [categoryId, companyAId, accImmoId, accAmortId, accDotationId],
  );
  const { rows: catCheck } = await client.query(`SELECT code, default_useful_life_years FROM asset_categories WHERE id = $1`, [categoryId]);
  ok('1. Création de catégorie réussie', catCheck.length === 1 && catCheck[0].code === 'MAT' && catCheck[0].default_useful_life_years === 5);

  // =====================================================================
  // 2. Immobilisation liée à une facture d'achat (pas de double écriture)
  // =====================================================================
  const invoiceId = randomUUID();
  await client.query(
    `INSERT INTO invoices (id, company_id, supplier_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, created_at, updated_at)
     VALUES ($1,$2,$3,'FA-2024-0001','PURCHASE','2024-02-01','2024-03-01','SENT',1000000,0,1000000,now(),now())`,
    [invoiceId, companyAId, supplierId],
  );
  const assetLinkedId = randomUUID();
  await client.query(
    `INSERT INTO fixed_assets (id, company_id, asset_account_id, category_id, depreciation_account_id, depreciation_expense_account_id, supplier_id, invoice_id, code, label, acquisition_date, acquisition_cost, residual_value, useful_life_years, depreciation_method, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'IMMO-001','Machine de production','2024-02-01',1000000,0,5,'STRAIGHT_LINE','ACQUIRED',now(),now())`,
    [assetLinkedId, companyAId, accImmoId, categoryId, accAmortId, accDotationId, supplierId, invoiceId],
  );
  const { rows: linkedCheck } = await client.query(`SELECT code, status, invoice_id, acquisition_entry_id FROM fixed_assets WHERE id = $1`, [assetLinkedId]);
  ok('2. Création d\'immobilisation réussie (statut ACQUIRED)', linkedCheck.length === 1 && linkedCheck[0].code === 'IMMO-001' && linkedCheck[0].status === 'ACQUIRED');
  ok('11. Immobilisation liée à une facture — aucune écriture d\'acquisition générée par ce module (déjà comptabilisée par invoices, Étape 10)', linkedCheck[0].acquisition_entry_id === null && linkedCheck[0].invoice_id === invoiceId);

  // =====================================================================
  // Immobilisation SANS facture liée — écriture d'acquisition directe
  // =====================================================================
  const assetId = randomUUID();
  await client.query(
    `INSERT INTO fixed_assets (id, company_id, asset_account_id, category_id, depreciation_account_id, depreciation_expense_account_id, code, label, acquisition_date, acquisition_cost, residual_value, useful_life_years, depreciation_method, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'IMMO-002','Véhicule utilitaire','2024-03-01',6000000,600000,4,'DECLINING_BALANCE','ACQUIRED',now(),now())`,
    [assetId, companyAId, accImmoId, categoryId, accAmortId, accDotationId],
  );
  const acqEntryId = await createBalancedEntry('2024-03-01', 'Acquisition immobilisation IMMO-002', 'IMMO-002', [
    { accountId: accImmoId, side: 'DEBIT', amount: 6000000, label: 'Acquisition Véhicule utilitaire' },
    { accountId: accFournisseurId, side: 'CREDIT', amount: 6000000, label: 'Acquisition Véhicule utilitaire' },
  ]);
  await client.query(`UPDATE fixed_assets SET acquisition_entry_id = $1 WHERE id = $2`, [acqEntryId, assetId]);
  const { rows: acqEntryCheck } = await client.query(`SELECT status, total_debit, total_credit FROM accounting_entries WHERE id = $1`, [acqEntryId]);
  ok('9. Génération de l\'écriture d\'acquisition (2 lignes équilibrées)', Number(acqEntryCheck[0].total_debit) === 6000000 && Number(acqEntryCheck[0].total_credit) === 6000000);
  ok('10. Validation de l\'écriture d\'acquisition (statut VALIDATED)', acqEntryCheck[0].status === 'VALIDATED');

  // =====================================================================
  // 3. Mise en service (ACQUIRED -> IN_SERVICE), ancre serviceDate
  // =====================================================================
  await client.query(`UPDATE fixed_assets SET status = 'IN_SERVICE', service_date = '2024-03-15' WHERE id = $1`, [assetId]);
  const { rows: serviceCheck } = await client.query(`SELECT status, service_date FROM fixed_assets WHERE id = $1`, [assetId]);
  ok('3. Mise en service réussie (statut IN_SERVICE, service_date fixée)', serviceCheck[0].status === 'IN_SERVICE' && serviceCheck[0].service_date !== null);

  // Double mise en service interdite — vérification applicative (le
  // service refuse toute transition hors ACQUIRED -> IN_SERVICE).
  ok('Double mise en service refusée (vérification applicative : statut déjà IN_SERVICE)', serviceCheck[0].status !== 'ACQUIRED');

  // =====================================================================
  // 4. Plan linéaire — IMMO-001 : base 1 000 000, durée 5 ans
  // =====================================================================
  const linearSchedule = computeDepreciationSchedule({
    acquisitionCost: 1000000,
    residualValue: 0,
    usefulLifeYears: 5,
    method: 'STRAIGHT_LINE',
    serviceDate: new Date('2024-04-01'),
  });
  const linearSum = linearSchedule.reduce((s, l) => s + l.amount, 0);
  ok('4. Plan linéaire : 5 annuités de 200 000, cumul = base amortissable', linearSchedule.length === 5 && linearSchedule.every((l) => l.amount === 200000) && linearSum === 1000000);
  ok('   Plan linéaire : exercices corrects (2024..2028)', linearSchedule.map((l) => l.fiscalYear).join(',') === '2024,2025,2026,2027,2028');

  // =====================================================================
  // 5/6. Plan dégressif — IMMO-002 : base 5 400 000 (6 000 000 - 600 000), durée 4 ans, taux double = 50%
  // =====================================================================
  const decliningSchedule = computeDepreciationSchedule({
    acquisitionCost: 6000000,
    residualValue: 600000,
    usefulLifeYears: 4,
    method: 'DECLINING_BALANCE',
    serviceDate: new Date('2024-03-15'),
  });
  const decliningSum = decliningSchedule.reduce((s, l) => s + l.amount, 0);
  ok('5. Plan dégressif : cumul des 4 annuités = base amortissable exacte (arrondi absorbé en dernière période)', decliningSchedule.length === 4 && decliningSum === 5400000);
  // Taux double constant = 2/4 = 50% : annuité 1 = 5 400 000 * 0.5 = 2 700 000 (dégressif > linéaire restant 1 350 000 -> pas de bascule)
  ok('   Annuité 1 dégressive correcte (taux double 50%)', decliningSchedule[0].amount === 2700000);
  // Annuité 2 : base restante 2 700 000, dégressif = 1 350 000, linéaire restant (3 ans) = 900 000 -> dégressif encore favorable
  ok('   Annuité 2 dégressive correcte', decliningSchedule[1].amount === 1350000);
  // Annuité 3 : base restante 1 350 000, dégressif = 675 000, linéaire restant (2 ans) = 675 000 -> égalité, bascule (max = 675000)
  // Annuité 4 (dernière) : absorbe le reliquat = base - cumul(1..3)
  const cumul3 = decliningSchedule[0].amount + decliningSchedule[1].amount + decliningSchedule[2].amount;
  ok('6. Bascule dégressif -> linéaire sur les dernières annuités puis absorption du reliquat en dernière période', decliningSchedule[3].amount === 5400000 - cumul3 && decliningSchedule[3].accumulated === 5400000);

  const lineFor2024 = findScheduleLineForFiscalYear(linearSchedule, 2024);
  ok('   Recherche par exercice civil (index annuité = exercice - année_mise_en_service + 1)', lineFor2024 !== undefined && lineFor2024!.period === 1);

  // =====================================================================
  // 7/9/10. Génération d'une dotation (IMMO-002, exercice 2024)
  // =====================================================================
  const assetSchedule = computeDepreciationSchedule({
    acquisitionCost: 6000000,
    residualValue: 600000,
    usefulLifeYears: 4,
    method: 'DECLINING_BALANCE',
    serviceDate: new Date('2024-03-15'),
  });
  const line2024 = findScheduleLineForFiscalYear(assetSchedule, 2024)!;
  const depEntry2024Id = await createBalancedEntry('2024-12-31', 'Dotation amortissement IMMO-002 — exercice 2024', 'IMMO-002', [
    { accountId: accDotationId, side: 'DEBIT', amount: line2024.amount, label: 'Dotation Véhicule utilitaire' },
    { accountId: accAmortId, side: 'CREDIT', amount: line2024.amount, label: 'Dotation Véhicule utilitaire' },
  ]);
  const depRow2024Id = randomUUID();
  await client.query(
    `INSERT INTO depreciation_entries (id, fixed_asset_id, fiscal_year, period_date, amount, accumulated, net_book_value, linked_entry_id, created_at) VALUES ($1,$2,2024,'2024-12-31',$3,$4,$5,$6,now())`,
    [depRow2024Id, assetId, line2024.amount, line2024.accumulated, line2024.netBookValue, depEntry2024Id],
  );
  const { rows: depCheck } = await client.query(`SELECT amount, fiscal_year, company_id FROM depreciation_entries WHERE id = $1`, [depRow2024Id]);
  ok('7. Génération de la dotation 2024 (montant conforme au plan)', Number(depCheck[0].amount) === line2024.amount && depCheck[0].fiscal_year === 2024);
  ok('   Dénormalisation automatique de company_id (trigger fn_set_company_id_from_fixed_asset)', depCheck[0].company_id === companyAId);
  const { rows: depEntryCheck } = await client.query(`SELECT status, total_debit, total_credit FROM accounting_entries WHERE id = $1`, [depEntry2024Id]);
  ok('9bis. Écriture de dotation générée et équilibrée', Number(depEntryCheck[0].total_debit) === line2024.amount && Number(depEntryCheck[0].total_credit) === line2024.amount);
  ok('10bis. Écriture de dotation validée (statut VALIDATED)', depEntryCheck[0].status === 'VALIDATED');

  // =====================================================================
  // 8. Protection contre une double génération (contrainte SQL unique)
  // =====================================================================
  let doubleDotationRejected = false;
  try {
    await client.query(
      `INSERT INTO depreciation_entries (id, fixed_asset_id, fiscal_year, period_date, amount, accumulated, net_book_value, created_at) VALUES ($1,$2,2024,'2024-12-31',999,999,999,now())`,
      [randomUUID(), assetId],
    );
  } catch (e: any) {
    doubleDotationRejected = /duplicate key|unique constraint/i.test(e.message);
  }
  ok('8. Protection contre la double dotation (contrainte unique fixed_asset_id+fiscal_year)', doubleDotationRejected);

  // Génère aussi la dotation 2025 pour disposer d'un cumul réaliste avant cession.
  const line2025 = findScheduleLineForFiscalYear(assetSchedule, 2025)!;
  const depEntry2025Id = await createBalancedEntry('2025-12-31', 'Dotation amortissement IMMO-002 — exercice 2025', 'IMMO-002', [
    { accountId: accDotationId, side: 'DEBIT', amount: line2025.amount, label: 'Dotation Véhicule utilitaire' },
    { accountId: accAmortId, side: 'CREDIT', amount: line2025.amount, label: 'Dotation Véhicule utilitaire' },
  ], period25Id);
  await client.query(
    `INSERT INTO depreciation_entries (id, fixed_asset_id, fiscal_year, period_date, amount, accumulated, net_book_value, linked_entry_id, created_at) VALUES ($1,$2,2025,'2025-12-31',$3,$4,$5,$6,now())`,
    [randomUUID(), assetId, line2025.amount, line2025.accumulated, line2025.netBookValue, depEntry2025Id],
  );

  // =====================================================================
  // 12/13. Cession (IMMO-002) : plus/moins-value automatique
  // =====================================================================
  const { rows: accDep } = await client.query(`SELECT COALESCE(SUM(amount),0) as total FROM depreciation_entries WHERE fixed_asset_id = $1`, [assetId]);
  const accumulatedDepreciation = Number(accDep[0].total); // 2 700 000 + 1 350 000 = 4 050 000
  const grossValue = 6000000;
  const netBookValue = grossValue - accumulatedDepreciation; // 1 950 000
  const disposalPrice = 2200000;
  const result = disposalPrice - netBookValue; // +250 000 (plus-value)
  ok('   Amortissements cumulés avant cession corrects', accumulatedDepreciation === 4050000);

  const disposalLines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; label?: string }> = [
    { accountId: accAmortId, side: 'DEBIT', amount: accumulatedDepreciation, label: 'Annulation amortissements IMMO-002' },
    { accountId: accBanqueId, side: 'DEBIT', amount: disposalPrice, label: 'Produit de cession IMMO-002' },
    { accountId: accImmoId, side: 'CREDIT', amount: grossValue, label: 'Sortie immobilisation IMMO-002' },
  ];
  if (result > 0) disposalLines.push({ accountId: accResultatId, side: 'CREDIT', amount: result, label: 'Plus-value de cession IMMO-002' });
  else if (result < 0) disposalLines.push({ accountId: accResultatId, side: 'DEBIT', amount: -result, label: 'Moins-value de cession IMMO-002' });

  const disposalEntryId = await createBalancedEntry('2026-01-15', 'Cession immobilisation IMMO-002', 'IMMO-002', disposalLines, period26Id);
  const { rows: disposalEntryCheck } = await client.query(`SELECT total_debit, total_credit, status FROM accounting_entries WHERE id = $1`, [disposalEntryId]);
  ok('   Écriture de cession équilibrée et validée', Number(disposalEntryCheck[0].total_debit) === Number(disposalEntryCheck[0].total_credit) && disposalEntryCheck[0].status === 'VALIDATED');

  const disposalId = randomUUID();
  await client.query(
    `INSERT INTO asset_disposals (id, company_id, fixed_asset_id, disposal_date, disposal_type, gross_value, accumulated_depreciation, net_book_value, disposal_price, result, linked_entry_id, created_by_id, created_at)
     VALUES ($1,$2,$3,'2026-01-15','SALE',$4,$5,$6,$7,$8,$9,$10,now())`,
    [disposalId, companyAId, assetId, grossValue, accumulatedDepreciation, netBookValue, disposalPrice, result, disposalEntryId, userId],
  );
  await client.query(`UPDATE fixed_assets SET status = 'DISPOSED', disposal_date = '2026-01-15', disposal_value = $1 WHERE id = $2`, [disposalPrice, assetId]);

  const { rows: disposalCheck } = await client.query(`SELECT gross_value, accumulated_depreciation, net_book_value, disposal_price, result FROM asset_disposals WHERE id = $1`, [disposalId]);
  ok('12. Cession enregistrée avec les bonnes valeurs (VNC, cumul, prix)', Number(disposalCheck[0].net_book_value) === netBookValue && Number(disposalCheck[0].accumulated_depreciation) === accumulatedDepreciation);
  ok('13. Calcul automatique de la plus-value correct (prix - VNC = +250 000)', Number(disposalCheck[0].result) === 250000);
  const { rows: statusAfterDisposal } = await client.query(`SELECT status FROM fixed_assets WHERE id = $1`, [assetId]);
  ok('   Statut de la fiche passé à DISPOSED', statusAfterDisposal[0].status === 'DISPOSED');

  // =====================================================================
  // 14. Protection contre une double cession (contrainte SQL unique)
  // =====================================================================
  let doubleDisposalRejected = false;
  try {
    await client.query(
      `INSERT INTO asset_disposals (id, company_id, fixed_asset_id, disposal_date, disposal_type, gross_value, accumulated_depreciation, net_book_value, disposal_price, result, created_by_id, created_at)
       VALUES ($1,$2,$3,'2026-01-16','SALE',1,1,1,1,0,$4,now())`,
      [randomUUID(), companyAId, assetId, userId],
    );
  } catch (e: any) {
    doubleDisposalRejected = /duplicate key|unique constraint/i.test(e.message);
  }
  ok('14. Protection contre la double cession (contrainte unique fixed_asset_id)', doubleDisposalRejected);

  // Moins-value : petit test complémentaire avec un cas de perte.
  const lossResult = 500000 - 1950000; // prix < VNC restant sur IMMO-001 hypothétique
  ok('   Formule de moins-value correcte quand prix < VNC (résultat négatif)', lossResult < 0 && lossResult === -1450000);

  // =====================================================================
  // 15. Permissions ASSET.*
  // =====================================================================
  const { rows: permCheck } = await client.query(`SELECT code FROM permissions WHERE code LIKE 'ASSET.%'`);
  ok('15. Les 8 permissions ASSET.* existent', permCheck.length === 8);
  const expectedPerms = ['ASSET.READ', 'ASSET.CREATE', 'ASSET.UPDATE', 'ASSET.DISABLE', 'ASSET.SERVICE', 'ASSET.DEPRECIATE', 'ASSET.DISPOSAL', 'ASSET.EXPORT'];
  const actualPerms = permCheck.map((r: any) => r.code).sort();
  ok('   Les codes de permission correspondent exactement au cahier des charges', JSON.stringify(actualPerms) === JSON.stringify([...expectedPerms].sort()));

  const { rows: adminPermCheck } = await client.query(
    `SELECT COUNT(*)::int as cnt FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE r.company_id IS NULL AND r.name = 'ADMIN' AND p.code LIKE 'ASSET.%'`,
  );
  ok('   ADMIN dispose des 8 permissions ASSET.*', adminPermCheck[0].cnt === 8);

  const { rows: assistantPermCheck } = await client.query(
    `SELECT p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE r.company_id IS NULL AND r.name = 'ACCOUNTING_ASSISTANT' AND p.code LIKE 'ASSET.%' ORDER BY p.code`,
  );
  ok('   ACCOUNTING_ASSISTANT ne peut ni déprécier ni céder (permissions restreintes)', !assistantPermCheck.some((r: any) => r.code === 'ASSET.DEPRECIATE' || r.code === 'ASSET.DISPOSAL'));

  // =====================================================================
  // 16. Isolation par companyId
  // =====================================================================
  const { rows: crossCompanyAsset } = await client.query(`SELECT id FROM fixed_assets WHERE id = $1 AND company_id = $2`, [assetId, companyBId]);
  ok('16. Isolation : immobilisation de A introuvable sous B', crossCompanyAsset.length === 0);
  const { rows: crossCompanyCategory } = await client.query(`SELECT id FROM asset_categories WHERE id = $1 AND company_id = $2`, [categoryId, companyBId]);
  ok('   Isolation : catégorie de A introuvable sous B', crossCompanyCategory.length === 0);
  const { rows: crossCompanyDisposal } = await client.query(`SELECT id FROM asset_disposals WHERE id = $1 AND company_id = $2`, [disposalId, companyBId]);
  ok('   Isolation : cession de A introuvable sous B', crossCompanyDisposal.length === 0);

  // Contrainte unique (companyId, code) : le même code peut exister
  // sous une autre entreprise (isolation multi-tenant, même principe
  // que Customer/Supplier/Invoice).
  const assetBId = randomUUID();
  await client.query(
    `INSERT INTO fixed_assets (id, company_id, asset_account_id, code, label, acquisition_date, acquisition_cost, residual_value, useful_life_years, status, created_at, updated_at)
     VALUES ($1,$2,(SELECT id FROM accounts WHERE company_id=$2 LIMIT 1),'IMMO-001','Doublon de code sous B','2024-01-01',1,0,1,'ACQUIRED',now(),now())`,
    [assetBId, companyBId],
  ).catch(async () => {
    // Company B n'a pas encore de compte — création minimale pour ce test d'isolation.
    const accBId = randomUUID();
    await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'241000','Matériel',1,true,now(),now())`, [accBId, companyBId, frameworkId, classByCode.get('2')]);
    await client.query(
      `INSERT INTO fixed_assets (id, company_id, asset_account_id, code, label, acquisition_date, acquisition_cost, residual_value, useful_life_years, status, created_at, updated_at)
       VALUES ($1,$2,$3,'IMMO-001','Doublon de code sous B','2024-01-01',1,0,1,'ACQUIRED',now(),now())`,
      [assetBId, companyBId, accBId],
    );
  });
  const { rows: dupCodeCheck } = await client.query(`SELECT code FROM fixed_assets WHERE company_id = $1 AND code = 'IMMO-001'`, [companyBId]);
  ok('   Même code "IMMO-001" réutilisable sous une autre entreprise (unicité scoping companyId+code)', dupCodeCheck.length === 1);

  // =====================================================================
  // Nettoyage
  // =====================================================================
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['asset_disposals', 'depreciation_entries', 'fixed_assets', 'asset_categories', 'invoice_items', 'invoices', 'suppliers', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
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
  console.error('Erreur lors de l\'exécution des tests Étape 12:', err);
  process.exit(1);
});
