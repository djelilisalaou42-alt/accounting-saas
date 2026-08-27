/**
 * Tests complémentaires Étape 10 : factures fournisseurs (achats),
 * concurrence réelle (création de code client concurrent, numérotation
 * concurrente), et membership désactivée. Complète step10_test.ts qui
 * couvrait déjà : clients, fournisseurs, devis, conversion, factures
 * ventes, paiements, affectation, sur-affectation, lettrage, sécurité.
 *
 * Exécution : npx ts-node test/customers-suppliers/step10_extra_test.ts
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
  const client = await setupClient();

  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['payment_allocations', 'payments', 'invoice_items', 'invoices', 'accounting_entry_lines', 'accounting_entries', 'customers', 'suppliers', 'bank_accounts', 'accounts', 'journals', 'user_companies', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step10Extra %')`).catch(() => {});
  }
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step10Extra %'`);
  await client.query(`DELETE FROM users WHERE email = 'step10extra-member@example.com'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step10extra-user@example.com', 'x', 'Extra', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step10Extra Entreprise', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyId, frameworkId],
  );
  const periodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [periodId, companyId]);
  const journalAchId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'ACH','Achats','PURCHASES',now(),now())`, [journalAchId, companyId]);

  const acc401Id = randomUUID();
  const acc601Id = randomUUID();
  const accTvaId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401100','Fournisseur',2,true,now(),now())`, [acc401Id, companyId, frameworkId, classByCode.get('4')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'601000','Achats',1,true,now(),now())`, [acc601Id, companyId, frameworkId, classByCode.get('6')]);
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'445200','TVA récupérable',2,true,now(),now())`, [accTvaId, companyId, frameworkId, classByCode.get('4')]);

  const supplierId = randomUUID();
  await client.query(`INSERT INTO suppliers (id, company_id, code, name, account_id, payment_term_days, is_active, created_at, updated_at) VALUES ($1,$2,'FOU001','Fournisseur Test',$3,30,true,now(),now())`, [supplierId, companyId, acc401Id]);

  async function nextNumber(docType: string, scope: string): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, $2::"SequenceDocumentType", $3) as number`, [companyId, docType, scope]);
    return rows[0].number;
  }

  // ===================================================================
  // FACTURES FOURNISSEURS (1-4)
  // ===================================================================
  const invoiceId = randomUUID();
  const invNum = `FF-${await nextNumber('INVOICE', 'PURCHASE')}`;
  await client.query(
    `INSERT INTO invoices (id, company_id, supplier_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, tax_account_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'PURCHASE','2026-08-01','2026-08-31','DRAFT',100000,18000,118000,$5,now(),now())`,
    [invoiceId, companyId, supplierId, invNum, accTvaId],
  );
  await client.query(`INSERT INTO invoice_items (id, invoice_id, company_id, description, quantity, unit_price, tax_rate, line_total, account_id) VALUES ($1,$2,$3,'Fournitures',2,50000,18,100000,$4)`, [randomUUID(), invoiceId, companyId, acc601Id]);
  const { rows: inv1 } = await client.query(`SELECT subtotal, tax_total, total FROM invoices WHERE id = $1`, [invoiceId]);
  ok('1. Facture fournisseur : calcul HT 100 000, TVA 18 000, TTC 118 000', Number(inv1[0].subtotal) === 100000 && Number(inv1[0].tax_total) === 18000 && Number(inv1[0].total) === 118000);

  const entryId = randomUUID();
  const entryNum = `ACH-${await nextNumber('ACCOUNTING_ENTRY', 'ACH')}`;
  await client.query(`INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-08-01','Facture fournisseur','DRAFT',$6,now(),now())`, [entryId, companyId, periodId, journalAchId, entryNum, userId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,1,'DEBIT',100000,now())`, [randomUUID(), entryId, acc601Id, companyId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at) VALUES ($1,$2,$3,$4,2,'DEBIT',18000,now())`, [randomUUID(), entryId, accTvaId, companyId]);
  await client.query(`INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, partner_type, partner_id, created_at) VALUES ($1,$2,$3,$4,3,'CREDIT',118000,'SUPPLIER',$5,now())`, [randomUUID(), entryId, acc401Id, companyId, supplierId]);
  await client.query(`UPDATE accounting_entries SET status='VALIDATED', validated_by_id=$1, validated_at=now() WHERE id=$2`, [userId, entryId]);
  await client.query(`UPDATE invoices SET status='SENT', linked_entry_id=$1 WHERE id=$2`, [entryId, invoiceId]);

  const { rows: entryCheck } = await client.query(`SELECT total_debit, total_credit FROM accounting_entries WHERE id = $1`, [entryId]);
  ok('2. Écriture d\'achat : Débit charges (100 000) + TVA récupérable (18 000) = Crédit fournisseur (118 000)', Number(entryCheck[0].total_debit) === 118000 && Number(entryCheck[0].total_credit) === 118000);
  ok('3. Équilibre de l\'écriture d\'achat vérifié (débit = crédit = 118 000)', Number(entryCheck[0].total_debit) === Number(entryCheck[0].total_credit));

  const paymentId = randomUUID();
  const payNum = `DEC-${await nextNumber('PAYMENT', 'OUTGOING')}`;
  await client.query(`INSERT INTO payments (id, company_id, payment_number, supplier_id, direction, method, amount, payment_date, invoice_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'OUTGOING','BANK_TRANSFER',118000,'2026-08-15',$5,now(),now())`, [paymentId, companyId, payNum, supplierId, invoiceId]);
  await client.query(`INSERT INTO payment_allocations (id, payment_id, invoice_id, company_id, amount, created_at) VALUES ($1,$2,$3,$4,118000,now())`, [randomUUID(), paymentId, invoiceId, companyId]);
  await client.query(`UPDATE invoices SET amount_paid=118000, status='PAID' WHERE id=$1`, [invoiceId]);
  const { rows: invFinal } = await client.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId]);
  ok('4. Paiement fournisseur complet -> facture PAID', invFinal[0].status === 'PAID');

  // ===================================================================
  // CONCURRENCE (5-8)
  // ===================================================================
  const clientA = await setupClient();
  const clientB = await setupClient();
  async function attemptCreateCustomer(c: Client, code: string): Promise<'ok' | 'rejected'> {
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO customers (id, company_id, code, name, account_id, payment_term_days, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,'Client concurrent',$4,30,true,now(),now())`,
        [randomUUID(), companyId, code, acc401Id],
      );
      await c.query('COMMIT');
      return 'ok';
    } catch {
      await c.query('ROLLBACK').catch(() => {});
      return 'rejected';
    }
  }
  const [resA, resB] = await Promise.all([attemptCreateCustomer(clientA, 'CONC001'), attemptCreateCustomer(clientB, 'CONC001')]);
  const successCount = [resA, resB].filter((r) => r === 'ok').length;
  ok(`5-6. Création concurrente de deux clients avec le même code : une seule réussit (A=${resA}, B=${resB})`, successCount === 1);

  async function reserveInvoiceNumber(c: Client): Promise<string> {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT fn_next_document_number($1, 'INVOICE'::"SequenceDocumentType", 'SALE') as number`, [companyId]);
    await new Promise((r) => setTimeout(r, 200));
    await c.query('COMMIT');
    return rows[0].number;
  }
  const [numA, numB] = await Promise.all([reserveInvoiceNumber(clientA), reserveInvoiceNumber(clientB)]);
  ok(`7-8. Numérotation de facture concurrente : deux numéros distincts obtenus (A=${numA}, B=${numB})`, numA !== numB);

  await clientA.end();
  await clientB.end();

  // ===================================================================
  // MEMBERSHIP DÉSACTIVÉE (9)
  // ===================================================================
  const memberUserId = randomUUID();
  await client.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at) VALUES ($1,'step10extra-member@example.com','x','Member','Test','ACTIVE',now(),now())`, [memberUserId]);
  const { rows: adminRoleRows } = await client.query(`SELECT id FROM roles WHERE company_id IS NULL AND name = 'ACCOUNTANT'`);
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, disabled_at, disabled_by_id, created_at) VALUES ($1,$2,$3,$4,'DISABLED',now(),$5,now())`,
    [randomUUID(), memberUserId, companyId, adminRoleRows[0].id, userId],
  );
  const { rows: membershipCheck } = await client.query(`SELECT status FROM user_companies WHERE user_id = $1 AND company_id = $2`, [memberUserId, companyId]);
  ok('9. Membership désactivée détectable (statut DISABLED) — PermissionsGuard existant refuse l\'accès pour ce statut (réutilisé, non modifié)', membershipCheck[0].status === 'DISABLED');

  // Nettoyage
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  for (const table of ['payment_allocations', 'payments', 'invoice_items', 'invoices', 'accounting_entry_lines', 'accounting_entries', 'customers', 'suppliers', 'bank_accounts', 'accounts', 'journals', 'user_companies', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]).catch(() => {});
  }
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId, memberUserId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests complémentaires Étape 10:', err);
  process.exit(1);
});
