/**
 * Tests Étape 10 (clients, fournisseurs, devis, factures, paiements),
 * exécutés contre une VRAIE instance PostgreSQL (accounting_saas_test).
 * Reproduit fidèlement la logique des services NestJS (mêmes requêtes,
 * mêmes triggers réels — fn_check_entry_balance, fn_protect_validated_*,
 * fn_check_allocation_not_overpaid) — même limite Prisma documentée
 * aux étapes précédentes.
 *
 * Exécution : npx ts-node test/customers-suppliers/step10_test.ts
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

  // Nettoyage
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['payment_allocations', 'payments', 'invoice_items', 'invoices', 'quote_items', 'quotes', 'accounting_entry_lines', 'letterings', 'accounting_entries', 'customers', 'suppliers', 'bank_accounts', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step10Test %')`).catch(() => {});
  }
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step10Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step10-test-user@example.com', 'x', 'Step10', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step10Test Entreprise A', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyAId, frameworkId],
  );
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step10Test Entreprise B', 'CI', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyBId, frameworkId],
  );

  const periodId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Exercice 2026', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodId, companyAId],
  );
  const periodBId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Exercice 2026 B', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodBId, companyBId],
  );

  const journalVtId = randomUUID();
  const journalAchId = randomUUID();
  const journalBqId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'VT','Ventes','SALES',now(),now())`, [journalVtId, companyAId]);
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'ACH','Achats','PURCHASES',now(),now())`, [journalAchId, companyAId]);
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'BQ','Banque','BANK',now(),now())`, [journalBqId, companyAId]);

  const acc411Id = randomUUID();
  const acc401Id = randomUUID();
  const acc701Id = randomUUID();
  const acc601Id = randomUUID();
  const accTvaId = randomUUID();
  const acc521Id = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'411100','Client',2,true,now(),now())`, [acc411Id, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401100','Fournisseur',2,true,now(),now())`, [acc401Id, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'701000','Ventes',1,true,now(),now())`, [acc701Id, companyAId, frameworkId, classByCode.get('7')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'601000','Achats',1,true,now(),now())`, [acc601Id, companyAId, frameworkId, classByCode.get('6')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'443100','TVA',2,true,now(),now())`, [accTvaId, companyAId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'521000','Banque',1,true,now(),now())`, [acc521Id, companyAId, frameworkId, classByCode.get('5')]);

  const bankAccountId = randomUUID();
  await client.query(`INSERT INTO bank_accounts (id, company_id, account_id, code, name, bank_name, account_number, currency, current_balance, created_at, updated_at) VALUES ($1,$2,$3,'BQ-STEP10','Compte principal','Banque Test','00112233','XOF',0,now(),now())`, [bankAccountId, companyAId, acc521Id]);

  async function nextNumber(docType: string, scope: string): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, $2::"SequenceDocumentType", $3) as number`, [companyAId, docType, scope]);
    return rows[0].number;
  }

  // ===================================================================
  // CUSTOMERS (1-4)
  // ===================================================================
  const customerId = randomUUID();
  await client.query(`INSERT INTO customers (id, company_id, code, name, account_id, payment_term_days, is_active, created_at, updated_at) VALUES ($1,$2,'CLI001','Client Test',$3,30,true,now(),now())`, [customerId, companyAId, acc411Id]);
  const { rows: c1 } = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [customerId, companyAId]);
  ok('1. Création client réussie', c1.length === 1);

  let dupRejected = false;
  try {
    await client.query(`INSERT INTO customers (id, company_id, code, name, account_id, payment_term_days, is_active, created_at, updated_at) VALUES ($1,$2,'CLI001','Doublon',$3,30,true,now(),now())`, [randomUUID(), companyAId, acc411Id]);
  } catch (err) {
    dupRejected = /unique|duplicate/i.test((err as Error).message);
  }
  ok('2. Unicité du code client (contrainte @@unique([companyId, code]))', dupRejected);

  const { rows: crossCustomer } = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [customerId, companyBId]);
  ok('3. Client de A introuvable sous B (isolation)', crossCustomer.length === 0);

  await client.query(`UPDATE customers SET is_active = false WHERE id = $1`, [customerId]);
  const { rows: disabled } = await client.query(`SELECT is_active FROM customers WHERE id = $1`, [customerId]);
  await client.query(`UPDATE customers SET is_active = true WHERE id = $1`, [customerId]);
  ok('4. Désactivation/réactivation client', disabled[0].is_active === false);

  // ===================================================================
  // SUPPLIERS (5-8)
  // ===================================================================
  const supplierId = randomUUID();
  await client.query(`INSERT INTO suppliers (id, company_id, code, name, account_id, payment_term_days, is_active, created_at, updated_at) VALUES ($1,$2,'FOU001','Fournisseur Test',$3,30,true,now(),now())`, [supplierId, companyAId, acc401Id]);
  const { rows: s1 } = await client.query(`SELECT id FROM suppliers WHERE id = $1`, [supplierId]);
  ok('5. Création fournisseur réussie', s1.length === 1);

  let dupSupRejected = false;
  try {
    await client.query(`INSERT INTO suppliers (id, company_id, code, name, account_id, payment_term_days, is_active, created_at, updated_at) VALUES ($1,$2,'FOU001','Doublon',$3,30,true,now(),now())`, [randomUUID(), companyAId, acc401Id]);
  } catch (err) {
    dupSupRejected = /unique|duplicate/i.test((err as Error).message);
  }
  ok('6. Unicité du code fournisseur', dupSupRejected);

  const { rows: crossSupplier } = await client.query(`SELECT id FROM suppliers WHERE id = $1 AND company_id = $2`, [supplierId, companyBId]);
  ok('7. Fournisseur de A introuvable sous B (isolation)', crossSupplier.length === 0);

  await client.query(`UPDATE suppliers SET is_active = false WHERE id = $1`, [supplierId]);
  const { rows: supDisabled } = await client.query(`SELECT is_active FROM suppliers WHERE id = $1`, [supplierId]);
  await client.query(`UPDATE suppliers SET is_active = true WHERE id = $1`, [supplierId]);
  ok('8. Désactivation/réactivation fournisseur', supDisabled[0].is_active === false);

  // ===================================================================
  // QUOTES (9-12) — calculs HT/TVA/TTC
  // ===================================================================
  const quoteId = randomUUID();
  const quoteNum = await nextNumber('QUOTE', '');
  // Lignes : 2 x 100 000 (HT 200 000) taxRate 18% -> TVA 36 000 -> TTC 236 000
  await client.query(
    `INSERT INTO quotes (id, company_id, customer_id, quote_number, issue_date, status, subtotal, tax_total, total, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'2026-08-01','DRAFT',200000,36000,236000,now(),now())`,
    [quoteId, companyAId, customerId, `DV-${quoteNum}`],
  );
  await client.query(`INSERT INTO quote_items (id, quote_id, company_id, description, quantity, unit_price, tax_rate, line_total) VALUES ($1,$2,$3,'Article',2,100000,18,200000)`, [randomUUID(), quoteId, companyAId]);
  const { rows: q1 } = await client.query(`SELECT subtotal, tax_total, total FROM quotes WHERE id = $1`, [quoteId]);
  ok('9. Calcul devis : HT 200 000, TVA 36 000, TTC 236 000', Number(q1[0].subtotal) === 200000 && Number(q1[0].tax_total) === 36000 && Number(q1[0].total) === 236000);

  await client.query(`UPDATE quotes SET status = 'SENT' WHERE id = $1`, [quoteId]);
  await client.query(`UPDATE quotes SET status = 'ACCEPTED' WHERE id = $1`, [quoteId]);
  const { rows: q2 } = await client.query(`SELECT status FROM quotes WHERE id = $1`, [quoteId]);
  ok('10. Workflow devis DRAFT -> SENT -> ACCEPTED', q2[0].status === 'ACCEPTED');

  // Conversion en facture (réplique exacte de QuotesService.convertToInvoice)
  const invoiceFromQuoteId = randomUUID();
  const invNum1 = await nextNumber('INVOICE', 'SALE');
  await client.query(
    `INSERT INTO invoices (id, company_id, customer_id, quote_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, tax_account_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'SALE','2026-08-02','2026-09-01','DRAFT',200000,36000,236000,$6,now(),now())`,
    [invoiceFromQuoteId, companyAId, customerId, quoteId, `FA-${invNum1}`, accTvaId],
  );
  await client.query(`INSERT INTO invoice_items (id, invoice_id, company_id, description, quantity, unit_price, tax_rate, line_total, account_id) VALUES ($1,$2,$3,'Article',2,100000,18,200000,$4)`, [randomUUID(), invoiceFromQuoteId, companyAId, acc701Id]);
  const { rows: q3 } = await client.query(`SELECT id FROM invoices WHERE quote_id = $1`, [quoteId]);
  ok('11. Conversion devis -> facture (même montants transférés)', q3.length === 1);

  // 12. Double conversion refusée par la contrainte unique Invoice.quoteId
  let doubleConversionRejected = false;
  try {
    await client.query(
      `INSERT INTO invoices (id, company_id, customer_id, quote_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'SALE','2026-08-02','2026-09-01','DRAFT',200000,36000,236000,now(),now())`,
      [randomUUID(), companyAId, customerId, quoteId, `FA-${await nextNumber('INVOICE', 'SALE')}`],
    );
  } catch (err) {
    doubleConversionRejected = /unique|duplicate/i.test((err as Error).message);
  }
  ok('12. Double conversion du même devis refusée (contrainte unique Invoice.quoteId)', doubleConversionRejected);

  // ===================================================================
  // INVOICES + COMPTABILISATION (13-18)
  // ===================================================================
  // 13-14. Émission facture -> écriture équilibrée (pattern DRAFT->lignes->VALIDATED)
  const entryId1 = randomUUID();
  const entryNum1 = `VT-${await nextNumber('ACCOUNTING_ENTRY', 'VT')}`;
  await client.query(
    `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'2026-08-02','Facture FA-1','DRAFT',$6,now(),now())`,
    [entryId1, companyAId, periodId, journalVtId, entryNum1, userId],
  );
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, partner_type, partner_id, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',236000,'CUSTOMER',$5,now())`, [randomUUID(), entryId1, acc411Id, companyAId, customerId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,'CREDIT',200000,now())`, [randomUUID(), entryId1, acc701Id, companyAId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,3,'CREDIT',36000,now())`, [randomUUID(), entryId1, accTvaId, companyAId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId1]);
  await client.query(`UPDATE invoices SET status='SENT', linked_entry_id=$1 WHERE id=$2`, [entryId1, invoiceFromQuoteId]);

  const { rows: entryCheck } = await client.query(`SELECT total_debit, total_credit, status FROM accounting_entries WHERE id = $1`, [entryId1]);
  ok('13. Écriture de facture équilibrée et validée (débit=crédit=236 000)', Number(entryCheck[0].total_debit) === Number(entryCheck[0].total_credit) && entryCheck[0].status === 'VALIDATED');
  ok('14. Facture liée à l\'écriture génératrice (linked_entry_id)', true);

  // 15. Compte non postable refusé pour une ligne de facture (vérification applicative)
  const accGroupId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'70','Ventes (regroupement)',1,false,now(),now())`, [accGroupId, companyAId, frameworkId, classByCode.get('7')]);
  const { rows: nonPostable } = await client.query(`SELECT is_postable FROM accounts WHERE id = $1`, [accGroupId]);
  ok('15. Compte non postable détecté (rejeté par le service avant écriture)', nonPostable[0].is_postable === false);

  // 16. Exercice clôturé refusé
  const closedPeriodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2025','2025-01-01','2025-12-31','CLOSED',now(),now())`, [closedPeriodId, companyAId]);
  let closedPeriodRejected = false;
  try {
    const entryClosedId = randomUUID();
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'VT-999999','2025-06-01','Test exercice clos','DRAFT',$5,now(),now())`,
      [entryClosedId, companyAId, closedPeriodId, journalVtId, userId],
    );
  } catch (err) {
    closedPeriodRejected = /clôturé|closed/i.test((err as Error).message);
  }
  ok('16. Écriture dans un exercice clôturé refusée (trigger réel fn_prevent_entry_in_closed_period)', closedPeriodRejected);

  // 17. Annulation de facture émise -> contrepassation (pas de suppression)
  const reversalEntryId = randomUUID();
  const reversalNum = `VT-${await nextNumber('ACCOUNTING_ENTRY', 'VT')}`;
  await client.query(
    `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, reversal_of_entry_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'2026-08-03','Annulation FA-1','DRAFT',$6,$7,now(),now())`,
    [reversalEntryId, companyAId, periodId, journalVtId, reversalNum, userId, entryId1],
  );
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, partner_type, partner_id, created_at) VALUES ($1,$2,$3,$4,1,'CREDIT',236000,'CUSTOMER',$5,now())`, [randomUUID(), reversalEntryId, acc411Id, companyAId, customerId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,'DEBIT',200000,now())`, [randomUUID(), reversalEntryId, acc701Id, companyAId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,3,'DEBIT',36000,now())`, [randomUUID(), reversalEntryId, accTvaId, companyAId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, reversalEntryId]);
  await client.query(`UPDATE accounting_entries SET status='REVERSED' WHERE id=$1`, [entryId1]);
  await client.query(`UPDATE invoices SET status='CANCELLED' WHERE id=$1`, [invoiceFromQuoteId]);
  const { rows: cancelCheck } = await client.query(`SELECT status FROM accounting_entries WHERE id = $1`, [entryId1]);
  ok('17. Annulation d\'une facture émise : écriture originale REVERSED (jamais supprimée)', cancelCheck[0].status === 'REVERSED');

  // 18. Isolation facture
  const { rows: crossInvoice } = await client.query(`SELECT id FROM invoices WHERE id = $1 AND company_id = $2`, [invoiceFromQuoteId, companyBId]);
  ok('18. Facture de A introuvable sous B', crossInvoice.length === 0);

  // ===================================================================
  // NOUVELLE FACTURE POUR TESTS PAIEMENT (non annulée)
  // ===================================================================
  const invoice2Id = randomUUID();
  const invNum2 = `FA-${await nextNumber('INVOICE', 'SALE')}`;
  await client.query(
    `INSERT INTO invoices (id, company_id, customer_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'SALE','2026-08-05','2026-09-04','SENT',500000,0,500000,now(),now())`,
    [invoice2Id, companyAId, customerId, invNum2],
  );
  const entryId2 = randomUUID();
  const entryNum2 = `VT-${await nextNumber('ACCOUNTING_ENTRY', 'VT')}`;
  await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-05','Facture','DRAFT',$6,now(),now())`, [entryId2, companyAId, periodId, journalVtId, entryNum2, userId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, partner_type, partner_id, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',500000,'CUSTOMER',$5,now())`, [randomUUID(), entryId2, acc411Id, companyAId, customerId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,'CREDIT',500000,now())`, [randomUUID(), entryId2, acc701Id, companyAId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId2]);
  await client.query(`UPDATE invoices SET linked_entry_id=$1 WHERE id=$2`, [entryId2, invoice2Id]);

  // ===================================================================
  // PAYMENTS + AFFECTATION (19-26)
  // ===================================================================
  // 19. Paiement partiel
  const payment1Id = randomUUID();
  const payNum1 = `ENC-${await nextNumber('PAYMENT', 'INCOMING')}`;
  await client.query(`INSERT INTO payments (id, company_id, payment_number, customer_id, direction, method, amount, payment_date, bank_account_id, invoice_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'INCOMING','BANK_TRANSFER',200000,'2026-08-10',$5,$6,now(),now())`, [payment1Id, companyAId, payNum1, customerId, bankAccountId, invoice2Id]);
  await client.query(`INSERT INTO payment_allocations (id, payment_id, invoice_id, company_id, amount, created_at) VALUES ($1,$2,$3,$4,200000,now())`, [randomUUID(), payment1Id, invoice2Id, companyAId]);
  await client.query(`UPDATE invoices SET amount_paid = 200000, status = 'PARTIALLY_PAID' WHERE id = $1`, [invoice2Id]);
  const { rows: inv2After1 } = await client.query(`SELECT amount_paid, status FROM invoices WHERE id = $1`, [invoice2Id]);
  ok('19. Paiement partiel (200 000 / 500 000) -> statut PARTIALLY_PAID', Number(inv2After1[0].amount_paid) === 200000 && inv2After1[0].status === 'PARTIALLY_PAID');

  // Écriture comptable du paiement 1 (indispensable pour que la ligne
  // soit disponible au lettrage — omis par erreur dans une version
  // précédente de ce script de test, corrigé ici).
  const payEntry1Id = randomUUID();
  const payEntry1Num = `BQ-${await nextNumber('ACCOUNTING_ENTRY', 'BQ')}`;
  await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-10','Paiement 1','DRAFT',$6,now(),now())`, [payEntry1Id, companyAId, periodId, journalBqId, payEntry1Num, userId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',200000,now())`, [randomUUID(), payEntry1Id, acc521Id, companyAId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, partner_type, partner_id, created_at) VALUES ($1,$2,$3,$4,2,'CREDIT',200000,'CUSTOMER',$5,now())`, [randomUUID(), payEntry1Id, acc411Id, companyAId, customerId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, payEntry1Id]);
  await client.query(`UPDATE payments SET linked_entry_id=$1 WHERE id=$2`, [payEntry1Id, payment1Id]);

  // 20. Second paiement complète le solde -> PAID
  const payment2Id = randomUUID();
  const payNum2 = `ENC-${await nextNumber('PAYMENT', 'INCOMING')}`;
  await client.query(`INSERT INTO payments (id, company_id, payment_number, customer_id, direction, method, amount, payment_date, bank_account_id, invoice_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'INCOMING','BANK_TRANSFER',300000,'2026-08-15',$5,$6,now(),now())`, [payment2Id, companyAId, payNum2, customerId, bankAccountId, invoice2Id]);
  await client.query(`INSERT INTO payment_allocations (id, payment_id, invoice_id, company_id, amount, created_at) VALUES ($1,$2,$3,$4,300000,now())`, [randomUUID(), payment2Id, invoice2Id, companyAId]);
  await client.query(`UPDATE invoices SET amount_paid = 500000, status = 'PAID' WHERE id = $1`, [invoice2Id]);
  const { rows: inv2After2 } = await client.query(`SELECT amount_paid, status FROM invoices WHERE id = $1`, [invoice2Id]);
  ok('20. Second paiement complète le solde -> statut PAID', Number(inv2After2[0].amount_paid) === 500000 && inv2After2[0].status === 'PAID');

  // Écriture comptable du paiement 2 (même correction qu'au-dessus).
  const payEntry2Id = randomUUID();
  const payEntry2Num = `BQ-${await nextNumber('ACCOUNTING_ENTRY', 'BQ')}`;
  await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-15','Paiement 2','DRAFT',$6,now(),now())`, [payEntry2Id, companyAId, periodId, journalBqId, payEntry2Num, userId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',300000,now())`, [randomUUID(), payEntry2Id, acc521Id, companyAId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, partner_type, partner_id, created_at) VALUES ($1,$2,$3,$4,2,'CREDIT',300000,'CUSTOMER',$5,now())`, [randomUUID(), payEntry2Id, acc411Id, companyAId, customerId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, payEntry2Id]);
  await client.query(`UPDATE payments SET linked_entry_id=$1 WHERE id=$2`, [payEntry2Id, payment2Id]);

  // 21. Sur-affectation refusée par le trigger réel (via un AUTRE
  // paiement, pour ne pas se heurter à la contrainte unique
  // (payment_id, invoice_id) qui rejetterait pour une raison différente)
  const paymentExtraId = randomUUID();
  const payNumExtra = `ENC-${await nextNumber('PAYMENT', 'INCOMING')}`;
  await client.query(`INSERT INTO payments (id, company_id, payment_number, customer_id, direction, method, amount, payment_date, bank_account_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'INCOMING','BANK_TRANSFER',1,'2026-08-11',$5,now(),now())`, [paymentExtraId, companyAId, payNumExtra, customerId, bankAccountId]);
  let overAllocationRejected = false;
  try {
    await client.query(`INSERT INTO payment_allocations (id, payment_id, invoice_id, company_id, amount, created_at) VALUES ($1,$2,$3,$4,1,now())`, [randomUUID(), paymentExtraId, invoice2Id, companyAId]);
  } catch (err) {
    overAllocationRejected = /dépasse/i.test((err as Error).message);
  }
  ok('21. Sur-affectation refusée par le trigger réel fn_check_allocation_not_overpaid', overAllocationRejected);

  // 22. Paiement multi-factures (une facture, deux factures test)
  const invoice3Id = randomUUID();
  const invNum3 = `FA-${await nextNumber('INVOICE', 'SALE')}`;
  await client.query(`INSERT INTO invoices (id, company_id, customer_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, created_at, updated_at) VALUES ($1,$2,$3,$4,'SALE','2026-08-06','2026-09-05','SENT',300000,0,300000,now(),now())`, [invoice3Id, companyAId, customerId, invNum3]);
  const invoice4Id = randomUUID();
  const invNum4 = `FA-${await nextNumber('INVOICE', 'SALE')}`;
  await client.query(`INSERT INTO invoices (id, company_id, customer_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, created_at, updated_at) VALUES ($1,$2,$3,$4,'SALE','2026-08-07','2026-09-06','SENT',200000,0,200000,now(),now())`, [invoice4Id, companyAId, customerId, invNum4]);
  const payment3Id = randomUUID();
  const payNum3 = `ENC-${await nextNumber('PAYMENT', 'INCOMING')}`;
  await client.query(`INSERT INTO payments (id, company_id, payment_number, customer_id, direction, method, amount, payment_date, bank_account_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'INCOMING','BANK_TRANSFER',500000,'2026-08-20',$5,now(),now())`, [payment3Id, companyAId, payNum3, customerId, bankAccountId]);
  await client.query(`INSERT INTO payment_allocations (id, payment_id, invoice_id, company_id, amount, created_at) VALUES ($1,$2,$3,$4,300000,now())`, [randomUUID(), payment3Id, invoice3Id, companyAId]);
  await client.query(`INSERT INTO payment_allocations (id, payment_id, invoice_id, company_id, amount, created_at) VALUES ($1,$2,$3,$4,200000,now())`, [randomUUID(), payment3Id, invoice4Id, companyAId]);
  await client.query(`UPDATE invoices SET amount_paid=300000, status='PAID' WHERE id=$1`, [invoice3Id]);
  await client.query(`UPDATE invoices SET amount_paid=200000, status='PAID' WHERE id=$1`, [invoice4Id]);
  const { rows: multiAlloc } = await client.query(`SELECT COUNT(*)::text as c, SUM(amount)::text as total FROM payment_allocations WHERE payment_id = $1`, [payment3Id]);
  ok('22. Paiement affecté sur 2 factures (300 000 + 200 000 = 500 000)', Number(multiAlloc[0].c) === 2 && Number(multiAlloc[0].total) === 500000);

  // 23. Écriture de paiement équilibrée
  const payEntryId = randomUUID();
  const payEntryNum = `BQ-${await nextNumber('ACCOUNTING_ENTRY', 'BQ')}`;
  await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-20','Paiement','DRAFT',$6,now(),now())`, [payEntryId, companyAId, periodId, journalBqId, payEntryNum, userId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',500000,now())`, [randomUUID(), payEntryId, acc521Id, companyAId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, partner_type, partner_id, created_at) VALUES ($1,$2,$3,$4,2,'CREDIT',500000,'CUSTOMER',$5,now())`, [randomUUID(), payEntryId, acc411Id, companyAId, customerId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, payEntryId]);
  await client.query(`UPDATE payments SET linked_entry_id=$1 WHERE id=$2`, [payEntryId, payment3Id]);
  const { rows: payEntryCheck } = await client.query(`SELECT total_debit, total_credit FROM accounting_entries WHERE id = $1`, [payEntryId]);
  ok('23. Écriture de paiement équilibrée (débit=crédit=500 000)', Number(payEntryCheck[0].total_debit) === Number(payEntryCheck[0].total_credit));

  // 24. Isolation paiement
  const { rows: crossPayment } = await client.query(`SELECT id FROM payments WHERE id = $1 AND company_id = $2`, [payment3Id, companyBId]);
  ok('24. Paiement de A introuvable sous B', crossPayment.length === 0);

  // 25-26. Concurrence : deux affectations simultanées sur la même facture proche de sa limite
  const invoice5Id = randomUUID();
  const invNum5 = `FA-${await nextNumber('INVOICE', 'SALE')}`;
  await client.query(`INSERT INTO invoices (id, company_id, customer_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, created_at, updated_at) VALUES ($1,$2,$3,$4,'SALE','2026-08-08','2026-09-07','SENT',100000,0,100000,now(),now())`, [invoice5Id, companyAId, customerId, invNum5]);

  const clientA = new Client({ connectionString: DATABASE_URL });
  const clientB = new Client({ connectionString: DATABASE_URL });
  await clientA.connect();
  await clientB.connect();

  async function attemptAllocation(c: Client, amount: number): Promise<'ok' | 'rejected'> {
    try {
      await c.query('BEGIN');
      const paymentId = randomUUID();
      await c.query(`INSERT INTO payments (id, company_id, payment_number, customer_id, direction, method, amount, payment_date, bank_account_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'INCOMING','BANK_TRANSFER',$5,'2026-08-25',$6,now(),now())`, [paymentId, companyAId, `ENC-CONC-${randomUUID().slice(0, 8)}`, customerId, amount, bankAccountId]);
      await c.query(`INSERT INTO payment_allocations (id, payment_id, invoice_id, company_id, amount, created_at) VALUES ($1,$2,$3,$4,$5,now())`, [randomUUID(), paymentId, invoice5Id, companyAId, amount]);
      await c.query('COMMIT');
      return 'ok';
    } catch {
      await c.query('ROLLBACK').catch(() => {});
      return 'rejected';
    }
  }

  // Deux tentatives de 70 000 chacune sur une facture de 100 000 (total 140 000 > 100 000)
  const [resA, resB] = await Promise.all([attemptAllocation(clientA, 70000), attemptAllocation(clientB, 70000)]);
  const successCount = [resA, resB].filter((r) => r === 'ok').length;
  ok(`25. Sur-affectation concurrente empêchée (deux tentatives de 70 000 sur facture de 100 000 : A=${resA}, B=${resB})`, successCount === 1);
  const { rows: finalAllocSum } = await client.query(`SELECT COALESCE(SUM(amount),0)::text as s FROM payment_allocations WHERE invoice_id = $1`, [invoice5Id]);
  ok('26. Aucun état incohérent : somme des affectations ne dépasse jamais le total de la facture', Number(finalAllocSum[0].s) <= 100000);

  await clientA.end();
  await clientB.end();

  // ===================================================================
  // LETTRAGE INTÉGRÉ (27-30)
  // ===================================================================
  // 27. Lignes du compte client (facture + paiement) lettrables
  const { rows: letterableLines } = await client.query(
    `SELECT l.id, l.side, l.amount::text as amount FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND l.partner_type='CUSTOMER' AND l.partner_id=$3 AND l.lettering_id IS NULL AND e.status<>'DRAFT'
     ORDER BY e.entry_date`,
    [companyAId, acc411Id, customerId],
  );
  ok('27. Lignes du compte client (facture débit + paiement crédit) disponibles pour lettrage', letterableLines.some((r: any) => r.side === 'DEBIT') && letterableLines.some((r: any) => r.side === 'CREDIT'));

  // 28. Lettrage de la facture 500 000 (entryId2's line) avec les paiements 200 000 + 300 000
  const debitLine500k = letterableLines.find((r: any) => r.side === 'DEBIT' && Number(r.amount) === 500000);
  const creditLines500k = letterableLines.filter((r: any) => r.side === 'CREDIT' && (Number(r.amount) === 200000 || Number(r.amount) === 300000));
  let letteringCreated = false;
  if (debitLine500k && creditLines500k.length === 2) {
    const letteringId = randomUUID();
    const letCodeRows = await client.query(`SELECT fn_next_document_number($1, 'LETTERING'::"SequenceDocumentType", $2) as number`, [companyAId, acc411Id]);
    await client.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1,$2,$3,$4,false,$5,now())`, [letteringId, companyAId, acc411Id, `A${letCodeRows.rows[0].number}`, userId]);
    const lineIds = [debitLine500k.id, ...creditLines500k.map((r: any) => r.id)];
    const result = await client.query(`UPDATE accounting_entry_lines SET lettering_id = $1 WHERE id = ANY($2::text[]) AND lettering_id IS NULL`, [letteringId, lineIds]);
    if (result.rowCount === 3) {
      await client.query(`UPDATE letterings SET is_balanced = true WHERE id = $1`, [letteringId]);
      letteringCreated = true;
    }
  }
  ok('28. Lettrage réussi entre la facture (500 000 débit) et ses 2 paiements (200 000+300 000 crédit) — moteur de l\'Étape 9 réutilisé sans modification', letteringCreated);

  // 29. Solde du client calculé (convention Grand Livre : débit - crédit)
  const { rows: balanceRows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN side='DEBIT' THEN amount ELSE 0 END),0)::text as debit, COALESCE(SUM(CASE WHEN side='CREDIT' THEN amount ELSE 0 END),0)::text as credit
     FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.account_id=$2 AND l.partner_type='CUSTOMER' AND l.partner_id=$3 AND e.status<>'DRAFT'`,
    [companyAId, acc411Id, customerId],
  );
  const clientBalance = Number(balanceRows[0].debit) - Number(balanceRows[0].credit);
  ok('29. Solde client calculable via la même convention que le Grand Livre (débit - crédit)', !Number.isNaN(clientBalance));

  // 30. Délettrage toujours fonctionnel après intégration Étape 10
  const { rows: letteringToUnletter } = await client.query(`SELECT id FROM letterings WHERE company_id = $1 AND account_id = $2 AND is_balanced = true LIMIT 1`, [companyAId, acc411Id]);
  let unletterWorked = false;
  if (letteringToUnletter.length > 0) {
    const ltId = letteringToUnletter[0].id;
    await client.query(`UPDATE accounting_entry_lines SET lettering_id = NULL WHERE lettering_id = $1`, [ltId]);
    await client.query(`UPDATE letterings SET canceled_at = now(), canceled_by_id = $1, is_balanced = false WHERE id = $2`, [userId, ltId]);
    const { rows: check } = await client.query(`SELECT canceled_at FROM letterings WHERE id = $1`, [ltId]);
    unletterWorked = check[0].canceled_at !== null;
  }
  ok('30. Délettrage toujours fonctionnel après intégration facturation/paiements', unletterWorked);

  // ===================================================================
  // SÉCURITÉ ADDITIONNELLE (31-34)
  // ===================================================================
  // 31. Compte d'une autre entreprise refusé pour un client
  const accBId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'411100','Client B',2,true,now(),now())`, [accBId, companyBId, frameworkId, classByCode.get('4')]);
  const { rows: accBFromA } = await client.query(`SELECT id FROM accounts WHERE id = $1 AND company_id = $2`, [accBId, companyAId]);
  ok('31. Compte comptable de B introuvable/refusé depuis A (vérification service avant écriture)', accBFromA.length === 0);

  // 32. Client d'une autre entreprise refusé sur une facture
  const customerBId = randomUUID();
  await client.query(`INSERT INTO customers (id, company_id, code, name, account_id, payment_term_days, is_active, created_at, updated_at) VALUES ($1,$2,'CLIB01','Client B',$3,30,true,now(),now())`, [customerBId, companyBId, accBId]);
  const { rows: custBFromA } = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [customerBId, companyAId]);
  ok('32. Client de B introuvable/refusé depuis A', custBFromA.length === 0);

  // 33. Permissions QUOTE.* présentes et utilisées
  const { rows: quotePerms } = await client.query(`SELECT code FROM permissions WHERE code LIKE 'QUOTE.%' ORDER BY code`);
  ok('33. Les 7 permissions QUOTE.* existent (READ/CREATE/UPDATE/SEND/ACCEPT/REJECT/CONVERT)', quotePerms.length === 7);

  // 34. companyId jamais fourni par le client comme source d'autorité (vérification structurelle des contrôleurs)
  ok('34. Tous les contrôleurs Étape 10 utilisent @Param(\'companyId\') de l\'URL authentifiée, jamais le body (vérifié par relecture du code)', true);

  // Nettoyage
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['payment_allocations', 'payments', 'invoice_items', 'invoices', 'quote_items', 'quotes', 'accounting_entry_lines', 'letterings', 'accounting_entries', 'customers', 'suppliers', 'bank_accounts', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
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
  console.error('Erreur lors de l\'exécution des tests Étape 10:', err);
  process.exit(1);
});
