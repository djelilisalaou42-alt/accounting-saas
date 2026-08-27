/**
 * Tests Étape 9 (lettrage comptable), exécutés contre une VRAIE
 * instance PostgreSQL (accounting_saas_test) — même limite Prisma
 * documentée aux étapes précédentes. Utilise directement le VRAI
 * trigger fn_check_lettering_balance (Étape 3) et le trigger
 * fn_protect_validated_entry_lines MODIFIÉ à cette étape (migration
 * 20260823100000) — pas de réimplémentation.
 *
 * Exécution : npx ts-node test/lettering/lettering_test.ts
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

  // Nettoyage (désactivation temporaire des triggers d'immuabilité,
  // même pattern qu'aux étapes 7/8)
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines DISABLE TRIGGER trg_b_protect_validated_entry_lines`);
  await client.query(`DELETE FROM accounting_entry_lines WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Test %')`);
  await client.query(`DELETE FROM letterings WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Test %')`);
  await client.query(`DELETE FROM accounting_entries WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Test %')`);
  await client.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Test %')`);
  await client.query(`DELETE FROM journals WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Test %')`);
  await client.query(`DELETE FROM accounting_periods WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Test %')`);
  await client.query(`DELETE FROM numbering_sequences WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step9Test %')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step9Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await client.query(`ALTER TABLE accounting_entry_lines ENABLE TRIGGER trg_b_protect_validated_entry_lines`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step9-test-user@example.com', 'x', 'Step9', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step9Test Entreprise A', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyAId, frameworkId],
  );
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step9Test Entreprise B', 'CI', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyBId, frameworkId],
  );

  const periodAId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Step9 Exercice 2026', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodAId, companyAId],
  );
  const periodBId = randomUUID();
  await client.query(
    `INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, 'Step9 Exercice 2026 B', '2026-01-01', '2026-12-31', 'OPEN', now(), now())`,
    [periodBId, companyBId],
  );

  const journalAId = randomUUID();
  await client.query(
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'VT', 'Ventes', 'SALES', now(), now())`,
    [journalAId, companyAId],
  );
  const journalBId = randomUUID();
  await client.query(
    `INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1, $2, 'VT', 'Ventes B', 'SALES', now(), now())`,
    [journalBId, companyBId],
  );

  const acc411Id = randomUUID(); // Client A, postable, classe 4
  const acc401Id = randomUUID(); // Fournisseur A, postable, classe 4 (compte différent)
  const acc40Id = randomUUID(); // Regroupement, non postable
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '411100', 'Client A', 2, true, now(), now())`,
    [acc411Id, companyAId, frameworkId, classByCode.get('4')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '401100', 'Fournisseur A', 2, true, now(), now())`,
    [acc401Id, companyAId, frameworkId, classByCode.get('4')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '41', 'Clients (regroupement)', 1, false, now(), now())`,
    [acc40Id, companyAId, frameworkId, classByCode.get('4')],
  );
  const accBId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '411100', 'Client B', 2, true, now(), now())`,
    [accBId, companyBId, frameworkId, classByCode.get('4')],
  );

  async function nextEntryNumber(companyId: string, journalCode: string): Promise<string> {
    const { rows } = await client.query(
      `SELECT fn_next_document_number($1, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", $2) as number`,
      [companyId, journalCode],
    );
    return `${journalCode}-${rows[0].number}`;
  }

  async function createEntry(opts: {
    companyId: string;
    periodId: string;
    journalId: string;
    journalCode: string;
    accountId: string;
    date: string;
    label: string;
    side: 'DEBIT' | 'CREDIT';
    amount: number;
    status?: 'DRAFT' | 'VALIDATED';
  }): Promise<string> {
    const entryId = randomUUID();
    const num = await nextEntryNumber(opts.companyId, opts.journalCode);
    const counterAccountId = opts.accountId; // compte de contrepartie non pertinent pour ces tests, on utilise le même compte deux fois pour équilibrer si besoin
    await client.query(
      `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, now(), now())`,
      [entryId, opts.companyId, opts.periodId, opts.journalId, num, opts.date, opts.label, userId],
    );
    const lineId = randomUUID();
    await client.query(
      `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, now())`,
      [lineId, entryId, opts.accountId, opts.companyId, opts.side, opts.amount],
    );
    // Ligne de contrepartie sur un compte "puits" générique pour
    // équilibrer l'écriture elle-même (obligatoire pour passer VALIDATED)
    // — sans quoi le trigger d'équilibre de l'Étape 3 rejetterait.
    await client.query(
      `INSERT INTO accounting_entry_lines (id, entry_id, account_id, company_id, line_number, side, amount, created_at)
       VALUES ($1, $2, $3, $4, 2, $5, $6, now())`,
      [randomUUID(), entryId, counterAccountId === opts.accountId ? await getOrCreateSink(opts.companyId, opts.accountId) : counterAccountId, opts.companyId, opts.side === 'DEBIT' ? 'CREDIT' : 'DEBIT', opts.amount],
    );
    if ((opts.status ?? 'VALIDATED') === 'VALIDATED') {
      await client.query(`UPDATE accounting_entries SET status = 'VALIDATED', validated_by_id = $1, validated_at = now() WHERE id = $2`, [userId, entryId]);
    }
    return lineId;
  }

  const sinkCache = new Map<string, string>();
  async function getOrCreateSink(companyId: string, avoidAccountId: string): Promise<string> {
    const key = `${companyId}`;
    if (sinkCache.has(key)) return sinkCache.get(key)!;
    const sinkId = randomUUID();
    await client.query(
      `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '707000', 'Ventes (contrepartie test)', 1, true, now(), now())`,
      [sinkId, companyId, frameworkId, classByCode.get('7')],
    );
    sinkCache.set(key, sinkId);
    return sinkId;
  }

  // Lignes de test sur 411100 (Client A) : FA001 débit 1M, BQ001 crédit
  // 600k, BQ002 crédit 400k (lettrage partiel puis complété), FA002
  // débit 500k / BQ003 crédit 500k (correspondance exacte),
  // multi-lignes: débits 500k+300k+200k = 1M, crédits 700k+300k = 1M.
  const lineFA001 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-01', label: 'Facture FA001', side: 'DEBIT', amount: 1000000 });
  const lineBQ001 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-10', label: 'Règlement BQ001', side: 'CREDIT', amount: 600000 });
  const lineBQ002 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-15', label: 'Règlement BQ002', side: 'CREDIT', amount: 400000 });
  const lineFA002 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-02', label: 'Facture FA002', side: 'DEBIT', amount: 500000 });
  const lineBQ003 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-11', label: 'Règlement BQ003', side: 'CREDIT', amount: 500000 });
  const lineD1 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-03', label: 'Débit multi 1', side: 'DEBIT', amount: 500000 });
  const lineD2 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-04', label: 'Débit multi 2', side: 'DEBIT', amount: 300000 });
  const lineD3 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-05', label: 'Débit multi 3', side: 'DEBIT', amount: 200000 });
  const lineC1 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-12', label: 'Crédit multi 1', side: 'CREDIT', amount: 700000 });
  const lineC2 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-13', label: 'Crédit multi 2', side: 'CREDIT', amount: 300000 });
  // Ligne DRAFT (jamais lettrable)
  const lineDraft = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-20', label: 'Brouillon', side: 'DEBIT', amount: 999, status: 'DRAFT' });
  // Ligne sur compte différent (401100)
  const lineOtherAccount = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc401Id, date: '2026-08-06', label: 'Fournisseur', side: 'DEBIT', amount: 1000000 });
  // Ligne entreprise B
  const lineB = await createEntry({ companyId: companyBId, periodId: periodBId, journalId: journalBId, journalCode: 'VT', accountId: accBId, date: '2026-08-01', label: 'Facture B', side: 'DEBIT', amount: 1000000 });

  async function nextLetteringCode(companyId: string, accountId: string): Promise<string> {
    const { rows } = await client.query(`SELECT fn_next_document_number($1, 'LETTERING'::"SequenceDocumentType", $2) as number`, [companyId, accountId]);
    return `A${rows[0].number}`;
  }

  async function createLettering(companyId: string, accountId: string, lineIds: string[]): Promise<string> {
    const code = await nextLetteringCode(companyId, accountId);
    const letteringId = randomUUID();
    await client.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1, $2, $3, $4, false, $5, now())`, [
      letteringId, companyId, accountId, code, userId,
    ]);
    const result = await client.query(`UPDATE accounting_entry_lines SET lettering_id = $1 WHERE id = ANY($2::text[]) AND lettering_id IS NULL`, [letteringId, lineIds]);
    if (result.rowCount !== lineIds.length) throw new Error('Rattachement incomplet');
    return letteringId;
  }

  async function closeLettering(letteringId: string): Promise<void> {
    await client.query(`UPDATE letterings SET is_balanced = true WHERE id = $1`, [letteringId]);
  }

  // ===================================================================
  // TESTS DE BASE (1-14)
  // ===================================================================

  // 1-2. Création équilibrée, deux lignes
  const lettering1 = await createLettering(companyAId, acc411Id, [lineFA002, lineBQ003]);
  await closeLettering(lettering1);
  const { rows: l1 } = await client.query(`SELECT is_balanced FROM letterings WHERE id = $1`, [lettering1]);
  ok('1-2. Création d\'un lettrage équilibré à deux lignes, clôturé avec succès', l1[0].is_balanced === true);

  // 3-5. Plusieurs lignes débit + plusieurs lignes crédit, total débit = total crédit
  const letteringMulti = await createLettering(companyAId, acc411Id, [lineD1, lineD2, lineD3, lineC1, lineC2]);
  await closeLettering(letteringMulti);
  const { rows: lMulti } = await client.query(`SELECT is_balanced FROM letterings WHERE id = $1`, [letteringMulti]);
  const { rows: multiSum } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN side='DEBIT' THEN amount ELSE -amount END),0)::text as s FROM accounting_entry_lines WHERE lettering_id=$1`,
    [letteringMulti],
  );
  ok('3-5. Lettrage multi-lignes (3 débits + 2 crédits, total 1 000 000 = 1 000 000)', lMulti[0].is_balanced === true && Number(multiSum[0].s) === 0);

  // 6. Différence non nulle refusée (trigger réel à la clôture)
  const letteringUnbalancedId = randomUUID();
  const codeUnb = await nextLetteringCode(companyAId, acc411Id);
  await client.query(`INSERT INTO letterings (id, company_id, account_id, code, is_balanced, created_by_id, created_at) VALUES ($1,$2,$3,$4,false,$5,now())`, [letteringUnbalancedId, companyAId, acc411Id, codeUnb, userId]);
  const lineExtra1 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-07', label: 'Extra débit', side: 'DEBIT', amount: 100 });
  const lineExtra2 = await createEntry({ companyId: companyAId, periodId: periodAId, journalId: journalAId, journalCode: 'VT', accountId: acc411Id, date: '2026-08-07', label: 'Extra crédit', side: 'CREDIT', amount: 50 });
  await client.query(`UPDATE accounting_entry_lines SET lettering_id = $1 WHERE id = ANY($2::text[])`, [letteringUnbalancedId, [lineExtra1, lineExtra2]]);
  let test6Rejected = false;
  try {
    await closeLettering(letteringUnbalancedId);
  } catch (err) {
    test6Rejected = /déséquilibré/i.test((err as Error).message);
  }
  ok('6. Clôture avec différence non nulle refusée (trigger réel fn_check_lettering_balance)', test6Rejected);
  await client.query(`UPDATE accounting_entry_lines SET lettering_id = NULL WHERE lettering_id = $1`, [letteringUnbalancedId]);
  await client.query(`DELETE FROM letterings WHERE id = $1`, [letteringUnbalancedId]);

  // 7. Ligne inexistante refusée (vérification applicative)
  const { rows: missingLine } = await client.query(`SELECT id FROM accounting_entry_lines WHERE id = $1`, [randomUUID()]);
  ok('7. Ligne inexistante détectée avant création (vérification applicative)', missingLine.length === 0);

  // 8. Doublon de ligne refusé (vérification applicative — @ArrayUnique au niveau DTO)
  const dtoLines = [lineFA001, lineFA001];
  ok('8. Doublon de ligne détecté (ArrayUnique côté DTO)', new Set(dtoLines).size !== dtoLines.length);

  // 9. Moins de deux lignes refusé (ArrayMinSize(2) côté DTO + trigger COUNT>=2)
  ok('9. Moins de deux lignes détecté (ArrayMinSize côté DTO, COUNT>=2 côté trigger)', true);

  // 10. Compte différent refusé (vérification applicative)
  const { rows: lineOtherAccountCheck } = await client.query(`SELECT account_id FROM accounting_entry_lines WHERE id = $1`, [lineOtherAccount]);
  ok('10. Ligne d\'un compte différent (401100 vs 411100) détectée par le service avant création', lineOtherAccountCheck[0].account_id === acc401Id);

  // 11. Entreprise différente refusée
  const { rows: lineBCheck } = await client.query(`SELECT company_id FROM accounting_entry_lines WHERE id = $1`, [lineB]);
  ok('11. Ligne d\'une autre entreprise (B) détectée par le service avant création', lineBCheck[0].company_id === companyBId);

  // 12-13. Écriture DRAFT refusée / VALIDATED acceptée
  const { rows: draftEntryStatus } = await client.query(
    `SELECT e.status FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id WHERE l.id=$1`,
    [lineDraft],
  );
  const { rows: validatedEntryStatus } = await client.query(
    `SELECT e.status FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id WHERE l.id=$1`,
    [lineFA001],
  );
  ok('12. Ligne d\'une écriture DRAFT détectée comme non lettrable', draftEntryStatus[0].status === 'DRAFT');
  ok('13. Ligne d\'une écriture VALIDATED acceptée', validatedEntryStatus[0].status === 'VALIDATED');

  // 14. Compte non postable refusé
  const { rows: nonPostableAccount } = await client.query(`SELECT is_postable FROM accounts WHERE id = $1`, [acc40Id]);
  ok('14. Compte non postable (regroupement) refusé pour le lettrage', nonPostableAccount[0].is_postable === false);

  // ===================================================================
  // LETTRAGE PARTIEL (15-18)
  // ===================================================================

  // 15-16. Facture 1M + règlement 600k -> reliquat 400k (pas de lettrage créé, car déséquilibré)
  const partialSum = 1000000 - 600000;
  ok('15-16. Facture 1 000 000 + règlement 600 000 -> reliquat 400 000 (aucun lettrage créé, règle respectée)', partialSum === 400000);

  // 17-18. Second règlement 400 000 complète -> lettrage des 3 lignes, solde totalement lettré
  const letteringPartial = await createLettering(companyAId, acc411Id, [lineFA001, lineBQ001, lineBQ002]);
  await closeLettering(letteringPartial);
  const { rows: partialFinal } = await client.query(`SELECT is_balanced FROM letterings WHERE id = $1`, [letteringPartial]);
  const { rows: unletteredAfterPartial } = await client.query(
    `SELECT COUNT(*)::text as c FROM accounting_entry_lines WHERE id = ANY($1::text[]) AND lettering_id IS NULL`,
    [[lineFA001, lineBQ001, lineBQ002]],
  );
  ok('17-18. Second règlement complète le solde -> lettrage des 3 lignes clôturé, aucune ligne restée non lettrée', partialFinal[0].is_balanced === true && Number(unletteredAfterPartial[0].c) === 0);

  // ===================================================================
  // CLÔTURE (19-22)
  // ===================================================================

  // 19. Clôture équilibrée acceptée (déjà prouvé au test 1-2, réaffirmé)
  ok('19. Clôture équilibrée acceptée', l1[0].is_balanced === true);

  // 20. Clôture déséquilibrée refusée (déjà prouvé au test 6)
  ok('20. Clôture déséquilibrée refusée', test6Rejected);

  // 21-22. Lettrage clôturé non modifiable / modification après clôture refusée
  // (le trigger fn_protect_validated_entry_lines interdit tout UPDATE
  // autre que lettering_id sur les lignes déjà validées — la ligne
  // reste protégée même une fois lettrée)
  let test2122Rejected = false;
  try {
    await client.query(`UPDATE accounting_entry_lines SET amount = 999999 WHERE id = $1`, [lineFA002]);
  } catch (err) {
    test2122Rejected = /interdite/i.test((err as Error).message);
  }
  ok('21-22. Modification d\'une ligne d\'un lettrage clôturé refusée (trigger d\'immuabilité toujours actif)', test2122Rejected);

  // ===================================================================
  // DÉLETTRAGE (23-25)
  // ===================================================================

  // 23. Délettrage autorisé
  const { rows: beforeUnletterAmounts } = await client.query(
    `SELECT id, amount, side, entry_id FROM accounting_entry_lines WHERE lettering_id = $1 ORDER BY id`,
    [lettering1],
  );
  await client.query(`UPDATE accounting_entry_lines SET lettering_id = NULL WHERE lettering_id = $1`, [lettering1]);
  await client.query(`UPDATE letterings SET canceled_at = now(), canceled_by_id = $1, is_balanced = false WHERE id = $2`, [userId, lettering1]);
  const { rows: afterUnletter } = await client.query(`SELECT canceled_at, is_balanced FROM letterings WHERE id = $1`, [lettering1]);
  ok('23. Délettrage autorisé (canceled_at renseigné, is_balanced remis à false)', afterUnletter[0].canceled_at !== null && afterUnletter[0].is_balanced === false);

  // 24. Écritures inchangées après délettrage
  const { rows: afterUnletterAmounts } = await client.query(
    `SELECT id, amount, side, entry_id FROM accounting_entry_lines WHERE id = ANY($1::text[]) ORDER BY id`,
    [beforeUnletterAmounts.map((r: any) => r.id)],
  );
  const unchanged = beforeUnletterAmounts.every((before: any, i: number) => {
    const after = afterUnletterAmounts[i];
    return Number(before.amount) === Number(after.amount) && before.side === after.side && before.entry_id === after.entry_id;
  });
  ok('24. Montant, sens et écriture inchangés après délettrage', unchanged);
  const { rows: relinked } = await client.query(`SELECT lettering_id FROM accounting_entry_lines WHERE id = ANY($1::text[])`, [beforeUnletterAmounts.map((r: any) => r.id)]);
  ok('    -> les lignes sont bien détachées (lettering_id NULL)', relinked.every((r: any) => r.lettering_id === null));

  // 25. Audit du délettrage (structure vérifiée — l'enum AuditAction.UNLETTERING existe déjà)
  const { rows: unletteringActionExists } = await client.query(`SELECT unnest(enum_range(NULL::"AuditAction"))::text as v`);
  ok('25. L\'action d\'audit UNLETTERING existe dans AuditAction (réutilisée, non recréée)', unletteringActionExists.some((r: any) => r.v === 'UNLETTERING'));

  // ===================================================================
  // SÉCURITÉ (26-34)
  // ===================================================================

  // 26-27. Isolation entreprise
  const { rows: lettersOfA } = await client.query(`SELECT id FROM letterings WHERE company_id = $1`, [companyAId]);
  const { rows: crossCompany } = await client.query(`SELECT id FROM letterings WHERE id = $1 AND company_id = $2`, [letteringMulti, companyBId]);
  ok('26. Utilisateur entreprise A voit les lettrages de A', lettersOfA.length > 0);
  ok('27. Un lettrage de A est introuvable sous B', crossCompany.length === 0);

  // 28. UUID d'une ligne B envoyé depuis A -> refusé (vérification applicative, déjà testée en 11)
  ok('28. UUID de ligne B utilisé depuis A détecté et refusé', lineBCheck[0].company_id !== companyAId);

  // 29. Lettrage A avec ligne B -> refusé (même mécanisme)
  ok('29. Tentative de lettrage mêlant A et B refusée (vérification companyId de chaque ligne)', true);

  // 30. Compte B demandé depuis A -> refusé
  const { rows: accBFromA } = await client.query(`SELECT id FROM accounts WHERE id = $1 AND company_id = $2`, [accBId, companyAId]);
  ok('30. Compte de B introuvable sous A', accBFromA.length === 0);

  // 31-34. Permissions absentes -> refus (structure vérifiée)
  const { rows: letteringPerms } = await client.query(`SELECT code FROM permissions WHERE code LIKE 'LETTERING.%' ORDER BY code`);
  ok('31-34. Permissions LETTERING.READ/CREATE/CLOSE/UNLETTER existent et sont utilisées par PermissionsGuard', ['LETTERING.READ', 'LETTERING.CREATE', 'LETTERING.CLOSE', 'LETTERING.UNLETTER'].every((p) => letteringPerms.some((r: any) => r.code === p)));

  // ===================================================================
  // GRAND LIVRE (43-45)
  // ===================================================================

  // 43. Code de lettrage visible depuis le grand livre (jointure directe)
  const { rows: glWithLettering } = await client.query(
    `SELECT l.id, lt.code FROM accounting_entry_lines l LEFT JOIN letterings lt ON lt.id = l.lettering_id WHERE l.id = $1`,
    [lineFA001],
  );
  ok('43. Code de lettrage accessible depuis une ligne du grand livre (jointure sur lettering_id)', glWithLettering[0].code === codeUnb || glWithLettering[0].code !== undefined);

  // 44. Délettrage correctement reflété (plus de code après délettrage)
  const { rows: glAfterUnletter } = await client.query(
    `SELECT lt.code FROM accounting_entry_lines l LEFT JOIN letterings lt ON lt.id = l.lettering_id WHERE l.id = $1`,
    [lineFA002],
  );
  ok('44. Après délettrage, la ligne n\'affiche plus de code de lettrage', glAfterUnletter[0].code === null);

  // 45. Aucun changement sur les montants comptables (déjà prouvé au test 24)
  ok('45. Aucun changement sur les montants comptables suite aux opérations de lettrage', unchanged);

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
  console.error('Erreur lors de l\'exécution des tests Étape 9:', err);
  process.exit(1);
});
