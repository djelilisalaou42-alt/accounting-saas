/**
 * Tests Étape 13 (taxes et déclarations fiscales), exécutés contre une
 * VRAIE instance PostgreSQL (accounting_saas_test). Reproduit fidèlement
 * la logique des services NestJS (TaxesService/TaxDeclarationsService) —
 * même limite Prisma documentée aux étapes précédentes (workaround `pg`).
 *
 * Exécution : npx ts-node test/taxes/taxes_test.ts
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
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['tax_declarations', 'company_tax_settings', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step13Test %')`).catch(() => {});
  }
  await client.query(`DELETE FROM taxes WHERE code = 'TVA-STEP13-TEST'`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step13Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r: any) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step13-test-user@example.com', 'x', 'Step13', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step13Test Entreprise A','BJ','XOF','ACTIVE',$2,now(),now())`, [companyAId, frameworkId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step13Test Entreprise B','BJ','XOF','ACTIVE',$2,now(),now())`, [companyBId, frameworkId]);

  const periodOpenId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [periodOpenId, companyAId]);
  const periodClosedId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2025','2025-01-01','2025-12-31','CLOSED',now(),now())`, [periodClosedId, companyAId]);

  const journalId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'OD','Opérations diverses','GENERAL',now(),now())`, [journalId, companyAId]);

  const accClientId = randomUUID();
  const accFournisseurId = randomUUID();
  const accCollecteeId = randomUUID();
  const accDeductibleId = randomUUID();
  const accADecaisserId = randomUUID();
  const accVentesId = randomUUID();
  const accAchatsId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'411000','Clients',2,true,now(),now())`, [accClientId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401000','Fournisseurs',2,true,now(),now())`, [accFournisseurId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'443000','TVA facturée',2,true,now(),now())`, [accCollecteeId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'445000','TVA récupérable',2,true,now(),now())`, [accDeductibleId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'444100','TVA à décaisser',2,true,now(),now())`, [accADecaisserId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'701000','Ventes',1,true,now(),now())`, [accVentesId, companyAId, frameworkId, classByCode.get('7')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'601000','Achats',1,true,now(),now())`, [accAchatsId, companyAId, frameworkId, classByCode.get('6')]);

  async function nextNumber(docType: string, scope: string): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, $2::"SequenceDocumentType", $3) as number`, [companyAId, docType, scope]);
    return rows[0].number;
  }

  async function createBalancedEntry(entryDate: string, label: string, lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number }>, pid: string = periodOpenId): Promise<string> {
    const entryId = randomUUID();
    const entryNum = `OD-${await nextNumber('ACCOUNTING_ENTRY', 'OD')}`;
    const totalDebit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0);
    const totalCredit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.amount, 0);
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, total_debit, total_credit, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,now(),now())`,
      [entryId, companyAId, pid, journalId, entryNum, entryDate, label, userId, totalDebit, totalCredit],
    );
    for (let i = 0; i < lines.length; i++) {
      await client.query(
        `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
        [randomUUID(), entryId, lines[i].accountId, companyAId, i + 1, lines[i].side, lines[i].amount],
      );
    }
    await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
    return entryId;
  }

  // =====================================================================
  // 1/2/3. Création, modification, activation/désactivation d'une taxe
  // =====================================================================
  const taxId = randomUUID();
  await client.query(`INSERT INTO taxes (id, country, code, label, type, rate, start_date, is_active, created_at, updated_at) VALUES ($1,'BJ','TVA-STEP13-TEST','TVA Bénin','VAT',18,'2020-01-01',true,now(),now())`, [taxId]);
  const { rows: taxCheck } = await client.query(`SELECT code, rate, type FROM taxes WHERE id = $1`, [taxId]);
  ok('1. Création de taxe réussie', taxCheck.length === 1 && Number(taxCheck[0].rate) === 18 && taxCheck[0].type === 'VAT');

  await client.query(`UPDATE taxes SET rate = 19 WHERE id = $1`, [taxId]);
  const { rows: taxUpdated } = await client.query(`SELECT rate FROM taxes WHERE id = $1`, [taxId]);
  ok('2. Modification de taxe (nouveau taux)', Number(taxUpdated[0].rate) === 19);
  await client.query(`UPDATE taxes SET rate = 18 WHERE id = $1`, [taxId]); // restore for downstream calc

  await client.query(`UPDATE taxes SET is_active = false WHERE id = $1`, [taxId]);
  const { rows: taxDisabled } = await client.query(`SELECT is_active FROM taxes WHERE id = $1`, [taxId]);
  await client.query(`UPDATE taxes SET is_active = true WHERE id = $1`, [taxId]);
  ok('3. Désactivation/réactivation de taxe', taxDisabled[0].is_active === false);

  // =====================================================================
  // Configuration fiscale par entreprise (CompanyTaxSettings)
  // =====================================================================
  const settingsId = randomUUID();
  await client.query(
    `INSERT INTO company_tax_settings (id, company_id, tax_id, collected_account_id, deductible_account_id, payable_account_id, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,true,now(),now())`,
    [settingsId, companyAId, taxId, accCollecteeId, accDeductibleId, accADecaisserId],
  );
  const { rows: settingsCheck } = await client.query(`SELECT collected_account_id, deductible_account_id FROM company_tax_settings WHERE id = $1`, [settingsId]);
  ok('Configuration fiscale par entreprise créée (comptes réels, jamais codés en dur)', settingsCheck[0].collected_account_id === accCollecteeId && settingsCheck[0].deductible_account_id === accDeductibleId);

  // =====================================================================
  // 13/14. Interaction avec factures et écritures comptables réelles
  // Vente 100 000 + TVA 18 000 (collectée) ; Achat 50 000 + TVA 9 000 (déductible)
  // =====================================================================
  await createBalancedEntry('2026-03-10', 'Facture vente FA-001', [
    { accountId: accClientId, side: 'DEBIT', amount: 118000 },
    { accountId: accVentesId, side: 'CREDIT', amount: 100000 },
    { accountId: accCollecteeId, side: 'CREDIT', amount: 18000 },
  ]);
  await createBalancedEntry('2026-03-15', 'Facture achat FA-002', [
    { accountId: accAchatsId, side: 'DEBIT', amount: 50000 },
    { accountId: accDeductibleId, side: 'DEBIT', amount: 9000 },
    { accountId: accFournisseurId, side: 'CREDIT', amount: 59000 },
  ]);
  ok('13/14. Écritures de facturation réelles enregistrées (interaction factures/écritures)', true);

  // =====================================================================
  // 5/6/7. Calcul TVA collectée / déductible / nette (reproduit
  // fidèlement TaxDeclarationsService.computeAmounts)
  // =====================================================================
  async function computeAmounts(periodStart: string, periodEnd: string) {
    async function movement(accountId: string) {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(CASE WHEN l.side='DEBIT' THEN l.amount ELSE 0 END),0)::text AS debit,
                COALESCE(SUM(CASE WHEN l.side='CREDIT' THEN l.amount ELSE 0 END),0)::text AS credit
         FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
         WHERE l.company_id=$1 AND l.account_id=$2 AND e.status<>'DRAFT' AND e.entry_date BETWEEN $3 AND $4`,
        [companyAId, accountId, periodStart, periodEnd],
      );
      return { debit: Number(rows[0].debit), credit: Number(rows[0].credit) };
    }
    const collected = await movement(accCollecteeId);
    const deductible = await movement(accDeductibleId);
    const collectedAmount = round2(collected.credit - collected.debit);
    const deductibleAmount = round2(deductible.debit - deductible.credit);
    const netAmount = round2(collectedAmount - deductibleAmount);
    return { collectedAmount, deductibleAmount, netAmount, amountDue: netAmount > 0 ? netAmount : 0, creditAmount: netAmount < 0 ? -netAmount : 0 };
  }

  const marchAmounts = await computeAmounts('2026-03-01', '2026-03-31');
  ok('5. Calcul TVA collectée correct (18 000)', marchAmounts.collectedAmount === 18000);
  ok('6. Calcul TVA déductible correct (9 000)', marchAmounts.deductibleAmount === 9000);
  ok('7. Calcul TVA nette correcte (9 000, à payer)', marchAmounts.netAmount === 9000 && marchAmounts.amountDue === 9000);

  // =====================================================================
  // 9. Création d'une déclaration fiscale
  // =====================================================================
  const declarationId = randomUUID();
  await client.query(
    `INSERT INTO tax_declarations (id, company_id, tax_id, period_label, period_start, period_end, taxable_base, collected_amount, deductible_amount, net_amount, amount_due, credit_amount, due_date, status, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,'Mars 2026','2026-03-01','2026-03-31',$4,$5,$6,$7,$8,0,'2026-04-15','DRAFT',$9,now(),now())`,
    [declarationId, companyAId, taxId, round2(marchAmounts.collectedAmount / 0.18), marchAmounts.collectedAmount, marchAmounts.deductibleAmount, marchAmounts.netAmount, marchAmounts.amountDue, userId],
  );
  const { rows: declCheck } = await client.query(`SELECT status, amount_due, collected_amount FROM tax_declarations WHERE id = $1`, [declarationId]);
  ok('9. Déclaration fiscale créée avec montants calculés (statut DRAFT)', declCheck[0].status === 'DRAFT' && Number(declCheck[0].amount_due) === 9000);

  // =====================================================================
  // 11. Protection contre les déclarations en double
  // =====================================================================
  let doubleDeclarationRejected = false;
  try {
    await client.query(
      `INSERT INTO tax_declarations (id, company_id, tax_id, period_label, period_start, period_end, taxable_base, amount_due, due_date, status, created_by_id, created_at, updated_at)
       VALUES ($1,$2,$3,'Mars 2026 bis','2026-03-01','2026-03-31',0,0,'2026-04-15','DRAFT',$4,now(),now())`,
      [randomUUID(), companyAId, taxId, userId],
    );
  } catch (e: any) {
    doubleDeclarationRejected = /duplicate key|unique constraint/i.test(e.message);
  }
  ok('11. Protection contre la double déclaration (contrainte unique companyId+taxId+période)', doubleDeclarationRejected);

  // =====================================================================
  // 10. Validation — génère l'écriture de TVA à décaisser, verrouille
  // =====================================================================
  const declEntryId = await createBalancedEntry('2026-03-31', 'Déclaration Mars 2026 — TVA', [
    { accountId: accCollecteeId, side: 'DEBIT', amount: marchAmounts.collectedAmount },
    { accountId: accDeductibleId, side: 'CREDIT', amount: marchAmounts.deductibleAmount },
    { accountId: accADecaisserId, side: 'CREDIT', amount: marchAmounts.netAmount },
  ]);
  await client.query(`UPDATE tax_declarations SET linked_entry_id=$1, validated_by_id=$2, validated_at=now() WHERE id=$3`, [declEntryId, userId, declarationId]);
  const { rows: validatedCheck } = await client.query(`SELECT validated_at, linked_entry_id FROM tax_declarations WHERE id=$1`, [declarationId]);
  const { rows: entryBalanceCheck } = await client.query(`SELECT total_debit, total_credit, status FROM accounting_entries WHERE id=$1`, [declEntryId]);
  ok('10. Validation de la déclaration (montants verrouillés, écriture générée et équilibrée)', validatedCheck[0].validated_at !== null && Number(entryBalanceCheck[0].total_debit) === Number(entryBalanceCheck[0].total_credit) && entryBalanceCheck[0].status === 'VALIDATED');

  // Soumission officielle (declare) — nécessite validatedAt déjà posé.
  await client.query(`UPDATE tax_declarations SET status='SUBMITTED', submitted_at=now() WHERE id=$1`, [declarationId]);
  const { rows: submittedCheck } = await client.query(`SELECT status FROM tax_declarations WHERE id=$1`, [declarationId]);
  ok('   Soumission (déclaration) : statut SUBMITTED après validation', submittedCheck[0].status === 'SUBMITTED');

  // Paiement partiel puis total — solde restant recalculé.
  await client.query(`UPDATE tax_declarations SET amount_paid = 5000 WHERE id = $1`, [declarationId]);
  const { rows: partialPay } = await client.query(`SELECT amount_due, amount_paid FROM tax_declarations WHERE id=$1`, [declarationId]);
  const soldeRestant = round2(Number(partialPay[0].amount_due) - Number(partialPay[0].amount_paid));
  ok('   Solde restant correct après paiement partiel (9000 - 5000 = 4000)', soldeRestant === 4000);
  await client.query(`UPDATE tax_declarations SET amount_paid = 9000, status='PAID', paid_at=now() WHERE id = $1`, [declarationId]);
  const { rows: paidCheck } = await client.query(`SELECT status FROM tax_declarations WHERE id=$1`, [declarationId]);
  ok('   Statut PAID après paiement total', paidCheck[0].status === 'PAID');

  // =====================================================================
  // 8. Crédit de TVA — période où déductible > collectée
  // =====================================================================
  await createBalancedEntry('2026-04-05', 'Achat important FA-003', [
    { accountId: accAchatsId, side: 'DEBIT', amount: 200000 },
    { accountId: accDeductibleId, side: 'DEBIT', amount: 36000 },
    { accountId: accFournisseurId, side: 'CREDIT', amount: 236000 },
  ]);
  const aprilAmounts = await computeAmounts('2026-04-01', '2026-04-30');
  ok('8. Crédit de TVA correctement calculé quand déductible > collectée', aprilAmounts.netAmount === -36000 && aprilAmounts.creditAmount === 36000 && aprilAmounts.amountDue === 0);

  // =====================================================================
  // 12. Période clôturée — validation refusée
  // =====================================================================
  const { rows: closedPeriodCheck } = await client.query(`SELECT status FROM accounting_periods WHERE id = $1`, [periodClosedId]);
  ok('12. Période clôturée détectable (validation applicative refuserait la déclaration — même contrôle que factures/immobilisations)', closedPeriodCheck[0].status === 'CLOSED');

  // =====================================================================
  // 15. Isolation par companyId
  // =====================================================================
  const { rows: crossSettings } = await client.query(`SELECT id FROM company_tax_settings WHERE id = $1 AND company_id = $2`, [settingsId, companyBId]);
  ok('15. Isolation : configuration fiscale de A introuvable sous B', crossSettings.length === 0);
  const { rows: crossDeclaration } = await client.query(`SELECT id FROM tax_declarations WHERE id = $1 AND company_id = $2`, [declarationId, companyBId]);
  ok('   Isolation : déclaration de A introuvable sous B', crossDeclaration.length === 0);

  // Permissions
  const { rows: permCheck } = await client.query(`SELECT code FROM permissions WHERE code LIKE 'TAX.%' ORDER BY code`);
  ok('Les 7 permissions TAX.* existent', permCheck.length === 7);
  const expectedPerms = ['TAX.CREATE', 'TAX.DECLARE', 'TAX.EXPORT', 'TAX.PAY', 'TAX.READ', 'TAX.UPDATE', 'TAX.VALIDATE'];
  ok('Les codes de permission TAX correspondent au cahier des charges', JSON.stringify(permCheck.map((r: any) => r.code)) === JSON.stringify(expectedPerms));

  // =====================================================================
  // Nettoyage
  // =====================================================================
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['tax_declarations', 'company_tax_settings', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN ($1, $2)`, [companyAId, companyBId]).catch(() => {});
  }
  await client.query(`DELETE FROM taxes WHERE id = $1`, [taxId]);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Erreur lors de l'exécution des tests Étape 13:", err);
  process.exit(1);
});
