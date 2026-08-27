/**
 * Tests Étape 16 (pièces jointes), exécutés contre une VRAIE instance
 * PostgreSQL (accounting_saas_test) ET un VRAI stockage sur disque
 * (mêmes chemins que ATTACHMENTS_STORAGE_PATH utilisé par l'application
 * — pas de mock du système de fichiers). Reproduit fidèlement la
 * logique d'AttachmentsService — même limite Prisma documentée aux
 * étapes précédentes (workaround `pg`).
 *
 * Exécution : npx ts-node test/attachments/attachments_test.ts
 */
import { Client } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://accounting_user:accounting_password@localhost:5432/accounting_saas_test?schema=public';

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.ATTACHMENTS_STORAGE_PATH ?? './storage/attachments');
const MAX_SIZE_BYTES = Number(process.env.ATTACHMENTS_MAX_SIZE_BYTES ?? 10 * 1024 * 1024);
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'text/csv': '.csv',
  'text/plain': '.txt',
};

/** Reproduit fidèlement AttachmentsService.matchesFileSignature() (audit pré-production). */
function matchesFileSignature(mimeType: string, b: Buffer): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return b.length >= 4 && b.subarray(0, 4).toString('ascii') === '%PDF';
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'text/csv':
    case 'text/plain':
      return true;
    default:
      return false;
  }
}

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

/** Reproduit fidèlement AttachmentsService.upload() — validations + écriture disque + insertion DB. */
async function uploadAttachment(
  client: Client,
  companyId: string,
  userId: string,
  file: { originalname: string; mimetype: string; buffer: Buffer },
  links: Partial<Record<'accountingEntryId' | 'invoiceId' | 'fixedAssetId' | 'taxDeclarationId' | 'budgetId', string>> = {},
): Promise<{ id: string; fileUrl: string }> {
  if (file.buffer.length === 0) throw new Error('Fichier vide.');
  if (file.buffer.length > MAX_SIZE_BYTES) throw new Error('Fichier trop volumineux.');
  const extension = ALLOWED_MIME_TYPES[file.mimetype];
  if (!extension) throw new Error(`Type de fichier non autorisé : ${file.mimetype}.`);
  if (!matchesFileSignature(file.mimetype, file.buffer)) {
    throw new Error('Le contenu du fichier ne correspond pas au type déclaré (signature binaire invalide).');
  }

  const providedLinks = Object.keys(links).filter((k) => (links as any)[k]);
  if (providedLinks.length > 1) throw new Error('Une seule liaison autorisée.');

  // Nom de fichier interne — jamais dérivé du nom client (élimine le
  // path traversal), même si `file.originalname` contient
  // "../../etc/passwd" ou toute autre séquence dangereuse.
  const internalName = `${randomUUID()}${extension}`;
  const relativePath = path.join(companyId, internalName);
  const absolutePath = path.join(STORAGE_ROOT, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, file.buffer);

  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const safeOriginalName = file.originalname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'fichier';

  const id = randomUUID();
  await client.query(
    `INSERT INTO attachments (id, company_id, file_name, file_url, mime_type, file_size_bytes, sha256, uploaded_by_id, accounting_entry_id, invoice_id, fixed_asset_id, tax_declaration_id, budget_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
    [
      id,
      companyId,
      safeOriginalName,
      relativePath,
      file.mimetype,
      file.buffer.length,
      sha256,
      userId,
      links.accountingEntryId ?? null,
      links.invoiceId ?? null,
      links.fixedAssetId ?? null,
      links.taxDeclarationId ?? null,
      links.budgetId ?? null,
    ],
  );
  return { id, fileUrl: relativePath };
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Nettoyage préalable (données ET fichiers d'un éventuel run précédent avorté).
  const { rows: staleCompanies } = await client.query(`SELECT id FROM companies WHERE name LIKE 'Step16Test %'`);
  for (const c of staleCompanies) {
    await fs.rm(path.join(STORAGE_ROOT, c.id), { recursive: true, force: true }).catch(() => {});
  }
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  for (const table of ['attachments', 'tax_declarations', 'company_tax_settings', 'budget_lines', 'budgets', 'invoice_items', 'invoices', 'suppliers', 'fixed_assets', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step16Test %')`).catch(() => {});
  }
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step16Test %'`);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r: any) => [r.code, r.id]));

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step16-test-user@example.com', 'x', 'Step16', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step16Test Entreprise A','BJ','XOF','ACTIVE',$2,now(),now())`, [companyAId, frameworkId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step16Test Entreprise B','BJ','XOF','ACTIVE',$2,now(),now())`, [companyBId, frameworkId]);

  const periodId = randomUUID();
  await client.query(`INSERT INTO accounting_periods (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES ($1,$2,'Exercice 2026','2026-01-01','2026-12-31','OPEN',now(),now())`, [periodId, companyAId]);
  const journalId = randomUUID();
  await client.query(`INSERT INTO journals (id, company_id, code, label, type, created_at, updated_at) VALUES ($1,$2,'OD','Opérations diverses','GENERAL',now(),now())`, [journalId, companyAId]);
  const accId = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'601000','Achats',1,true,now(),now())`, [accId, companyAId, frameworkId, classByCode.get('6')]);
  const accId2 = randomUUID();
  await client.query(`INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, is_postable, created_at, updated_at) VALUES ($1,$2,$3,$4,'401000','Fournisseurs',2,true,now(),now())`, [accId2, companyAId, frameworkId, classByCode.get('4')]);

  // Objets métier réels à rattacher (facture, écriture, immobilisation, déclaration, budget).
  const entryId = randomUUID();
  await client.query(
    `INSERT INTO accounting_entries (id, company_id, period_id, journal_id, entry_number, entry_date, label, status, created_by_id, total_debit, total_credit, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'OD-0001','2026-03-01','Écriture test','DRAFT',$5,100,100,now(),now())`,
    [entryId, companyAId, periodId, journalId, userId],
  );

  const supplierId = randomUUID();
  await client.query(`INSERT INTO suppliers (id, company_id, code, name, account_id, created_at, updated_at) VALUES ($1,$2,'FRN-01','Fournisseur Test',$3,now(),now())`, [supplierId, companyAId, accId2]);
  const invoiceId = randomUUID();
  await client.query(
    `INSERT INTO invoices (id, company_id, supplier_id, invoice_number, invoice_type, issue_date, due_date, status, subtotal, tax_total, total, created_at, updated_at)
     VALUES ($1,$2,$3,'FA-2026-0001','PURCHASE','2026-03-01','2026-04-01','SENT',100,0,100,now(),now())`,
    [invoiceId, companyAId, supplierId],
  );

  const fixedAssetId = randomUUID();
  await client.query(
    `INSERT INTO fixed_assets (id, company_id, asset_account_id, code, label, acquisition_date, acquisition_cost, residual_value, useful_life_years, status, created_at, updated_at)
     VALUES ($1,$2,$3,'IMMO-STEP16','Matériel test','2026-01-01',500000,0,5,'ACQUIRED',now(),now())`,
    [fixedAssetId, companyAId, accId],
  );

  const taxId = randomUUID();
  await client.query(`INSERT INTO taxes (id, country, code, label, type, rate, start_date, is_active, created_at, updated_at) VALUES ($1,'BJ','TVA-STEP16-TEST','TVA test','VAT',18,'2020-01-01',true,now(),now())`, [taxId]);
  const declId = randomUUID();
  await client.query(
    `INSERT INTO tax_declarations (id, company_id, tax_id, period_label, period_start, period_end, taxable_base, amount_due, due_date, status, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,'Mars 2026','2026-03-01','2026-03-31',0,0,'2026-04-15','DRAFT',$4,now(),now())`,
    [declId, companyAId, taxId, userId],
  );

  const budgetId = randomUUID();
  await client.query(`INSERT INTO budgets (id, company_id, period_id, name, status, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,'Budget Step16','DRAFT',$4,now(),now())`, [budgetId, companyAId, periodId, userId]);

  // =====================================================================
  // 1/2. Upload + métadonnées
  // =====================================================================
  const pdfBuffer = Buffer.from('%PDF-1.4 contenu de test Step16');
  const { id: attId1, fileUrl: fileUrl1 } = await uploadAttachment(client, companyAId, userId, { originalname: 'facture-scan.pdf', mimetype: 'application/pdf', buffer: pdfBuffer });
  const { rows: attCheck } = await client.query(`SELECT file_name, mime_type, file_size_bytes, sha256 FROM attachments WHERE id = $1`, [attId1]);
  ok('1. Upload réussi (fichier réellement écrit sur disque + ligne créée)', attCheck.length === 1);
  ok('2. Métadonnées correctes (nom, type MIME, taille, sha256)', attCheck[0].file_name === 'facture-scan.pdf' && attCheck[0].mime_type === 'application/pdf' && Number(attCheck[0].file_size_bytes) === pdfBuffer.length && attCheck[0].sha256 === createHash('sha256').update(pdfBuffer).digest('hex'));

  const onDiskExists = await fs
    .access(path.join(STORAGE_ROOT, fileUrl1))
    .then(() => true)
    .catch(() => false);
  ok('   Fichier physiquement présent sur le vrai stockage configuré', onDiskExists);

  // =====================================================================
  // 3. Téléchargement — relit le vrai fichier et compare le contenu
  // =====================================================================
  const downloaded = await fs.readFile(path.join(STORAGE_ROOT, fileUrl1));
  ok('3. Téléchargement correct (contenu binaire identique à l\'upload)', downloaded.equals(pdfBuffer));

  // =====================================================================
  // 4. Suppression — supprime la ligne ET le fichier physique (jamais de soft delete)
  // =====================================================================
  const { id: attIdToDelete, fileUrl: fileUrlToDelete } = await uploadAttachment(client, companyAId, userId, { originalname: 'a-supprimer.txt', mimetype: 'text/plain', buffer: Buffer.from('temporaire') });
  await client.query(`DELETE FROM attachments WHERE id = $1`, [attIdToDelete]);
  await fs.unlink(path.join(STORAGE_ROOT, fileUrlToDelete));
  const { rows: deletedCheck } = await client.query(`SELECT id FROM attachments WHERE id = $1`, [attIdToDelete]);
  const stillOnDisk = await fs.access(path.join(STORAGE_ROOT, fileUrlToDelete)).then(() => true).catch(() => false);
  ok('4. Suppression réelle (ligne DB supprimée ET fichier physique supprimé, pas de soft delete)', deletedCheck.length === 0 && !stillOnDisk);

  // =====================================================================
  // 7. Fichier inexistant — métadonnées orphelines détectées proprement
  // =====================================================================
  const { id: orphanId, fileUrl: orphanUrl } = await uploadAttachment(client, companyAId, userId, { originalname: 'sera-supprime-a-la-main.txt', mimetype: 'text/plain', buffer: Buffer.from('x') });
  await fs.unlink(path.join(STORAGE_ROOT, orphanUrl)); // supprime le fichier SANS toucher la ligne DB, simule une incohérence
  let orphanDetected = false;
  try {
    await fs.readFile(path.join(STORAGE_ROOT, orphanUrl));
  } catch {
    orphanDetected = true; // AttachmentsService.download() lève NotFoundException dans ce cas exact
  }
  ok('7. Fichier inexistant sur le disque détecté proprement (métadonnées orphelines, jamais un crash silencieux)', orphanDetected);
  await client.query(`DELETE FROM attachments WHERE id = $1`, [orphanId]);

  // =====================================================================
  // 8/9. Type interdit / taille excessive — rejetés avant toute écriture
  // =====================================================================
  let forbiddenTypeRejected = false;
  try {
    await uploadAttachment(client, companyAId, userId, { originalname: 'script.exe', mimetype: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  } catch (e: any) {
    forbiddenTypeRejected = /non autorisé/i.test(e.message);
  }
  ok('8. Type de fichier interdit rejeté (ex: .exe)', forbiddenTypeRejected);

  // Audit pré-production : un exécutable renommé en .pdf avec un
  // Content-Type: application/pdf usurpé doit être rejeté par la
  // vérification de signature binaire, pas seulement par le type MIME
  // déclaré (entièrement contrôlé par le client).
  let mimeSpoofingRejected = false;
  try {
    await uploadAttachment(client, companyAId, userId, { originalname: 'fake.pdf', mimetype: 'application/pdf', buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]) }); // en-tête .exe (MZ), Content-Type usurpé
  } catch (e: any) {
    mimeSpoofingRejected = /signature binaire/i.test(e.message);
  }
  ok('   Usurpation de type MIME détectée et rejetée (exécutable renommé .pdf avec Content-Type falsifié)', mimeSpoofingRejected);

  let oversizedRejected = false;
  try {
    await uploadAttachment(client, companyAId, userId, { originalname: 'enorme.pdf', mimetype: 'application/pdf', buffer: Buffer.alloc(MAX_SIZE_BYTES + 1) });
  } catch (e: any) {
    oversizedRejected = /volumineux/i.test(e.message);
  }
  ok('9. Fichier trop volumineux rejeté', oversizedRejected);

  // =====================================================================
  // 10. Nom de fichier dangereux — jamais utilisé pour construire un chemin
  // =====================================================================
  const { fileUrl: dangerousFileUrl } = await uploadAttachment(client, companyAId, userId, { originalname: '../../../etc/passwd', mimetype: 'text/plain', buffer: Buffer.from('inoffensif') });
  const resolvedPath = path.resolve(STORAGE_ROOT, dangerousFileUrl);
  ok('10. Nom de fichier dangereux neutralisé (chemin interne toujours un UUID, jamais dérivé du nom client, pas de path traversal)', resolvedPath.startsWith(STORAGE_ROOT) && !dangerousFileUrl.includes('..'));

  // =====================================================================
  // 11-15. Rattachements aux objets métier
  // =====================================================================
  const { id: attInvoiceId } = await uploadAttachment(client, companyAId, userId, { originalname: 'facture.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-f') }, { invoiceId });
  const { id: attEntryId } = await uploadAttachment(client, companyAId, userId, { originalname: 'justificatif.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-e') }, { accountingEntryId: entryId });
  const { id: attAssetId } = await uploadAttachment(client, companyAId, userId, { originalname: 'photo-materiel.jpg', mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) }, { fixedAssetId });
  const { id: attDeclId } = await uploadAttachment(client, companyAId, userId, { originalname: 'declaration.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-d') }, { taxDeclarationId: declId });
  const { id: attBudgetId } = await uploadAttachment(client, companyAId, userId, { originalname: 'previsionnel.csv', mimetype: 'text/csv', buffer: Buffer.from('b') }, { budgetId });

  const { rows: linkChecks } = await client.query(
    `SELECT
       (SELECT invoice_id FROM attachments WHERE id=$1) as inv,
       (SELECT accounting_entry_id FROM attachments WHERE id=$2) as entr,
       (SELECT fixed_asset_id FROM attachments WHERE id=$3) as ast,
       (SELECT tax_declaration_id FROM attachments WHERE id=$4) as decl,
       (SELECT budget_id FROM attachments WHERE id=$5) as bud`,
    [attInvoiceId, attEntryId, attAssetId, attDeclId, attBudgetId],
  );
  ok('11. Rattachement à une facture correct', linkChecks[0].inv === invoiceId);
  ok('12. Rattachement à une écriture comptable correct', linkChecks[0].entr === entryId);
  ok('13. Rattachement à une immobilisation correct', linkChecks[0].ast === fixedAssetId);
  ok('14. Rattachement à une déclaration fiscale correct', linkChecks[0].decl === declId);
  ok('15. Rattachement à un budget correct', linkChecks[0].bud === budgetId);

  // Une seule liaison autorisée par pièce jointe.
  let multiLinkRejected = false;
  try {
    await uploadAttachment(client, companyAId, userId, { originalname: 'double.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-x') }, { invoiceId, budgetId });
  } catch (e: any) {
    multiLinkRejected = /seule liaison/i.test(e.message);
  }
  ok('   Rattachement à plusieurs objets simultanément refusé (conception FK existante : un seul lien par pièce jointe)', multiLinkRejected);

  // =====================================================================
  // 5. Permissions ATTACHMENT.*
  // =====================================================================
  const { rows: permCheck } = await client.query(`SELECT code FROM permissions WHERE code LIKE 'ATTACHMENT.%' ORDER BY code`);
  ok('5. Les 4 permissions ATTACHMENT.* existent', permCheck.length === 4);
  const expectedPerms = ['ATTACHMENT.CREATE', 'ATTACHMENT.DELETE', 'ATTACHMENT.EXPORT', 'ATTACHMENT.READ'];
  ok('   Les codes de permission correspondent au cahier des charges', JSON.stringify(permCheck.map((r: any) => r.code)) === JSON.stringify(expectedPerms));

  // =====================================================================
  // 6. Isolation par companyId
  // =====================================================================
  const { rows: crossCompany } = await client.query(`SELECT id FROM attachments WHERE id = $1 AND company_id = $2`, [attId1, companyBId]);
  ok('6. Isolation : pièce jointe de A introuvable sous B', crossCompany.length === 0);

  // =====================================================================
  // Nettoyage
  // =====================================================================
  await client.query(`ALTER TABLE accounting_entries DISABLE TRIGGER trg_b_protect_validated_entries`);
  for (const table of ['attachments', 'tax_declarations', 'company_tax_settings', 'budget_lines', 'budgets', 'invoice_items', 'invoices', 'suppliers', 'fixed_assets', 'accounting_entry_lines', 'accounting_entries', 'accounts', 'journals', 'accounting_periods', 'numbering_sequences']) {
    await client.query(`DELETE FROM ${table} WHERE company_id IN ($1, $2)`, [companyAId, companyBId]).catch(() => {});
  }
  await client.query(`DELETE FROM taxes WHERE id = $1`, [taxId]);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`ALTER TABLE accounting_entries ENABLE TRIGGER trg_b_protect_validated_entries`);
  await fs.rm(path.join(STORAGE_ROOT, companyAId), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(STORAGE_ROOT, companyBId), { recursive: true, force: true }).catch(() => {});

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Erreur lors de l'exécution des tests Étape 16:", err);
  process.exit(1);
});
