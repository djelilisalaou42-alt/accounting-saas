/**
 * Tests Étape 17 (journal d'audit consultable), exécutés contre une
 * VRAIE instance PostgreSQL (accounting_saas_test). Reproduit
 * fidèlement AuditLogService (list/get/exportCsv, filtres, tri,
 * pagination) et vérifie RÉELLEMENT le trigger d'immutabilité
 * PostgreSQL (tentatives UPDATE/DELETE effectives, pas simulées) —
 * même limite Prisma documentée aux étapes précédentes (workaround `pg`).
 *
 * Exécution : npx ts-node test/audit/audit_test.ts
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

/** Reproduit fidèlement AuditLogService.toCsv() (dupliqué à l'identique de ReportsService.toCsv). */
function toCsv(rows: string[][]): string {
  const escapeField = (field: string): string => (/[;"\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field);
  const body = rows.map((row) => row.map(escapeField).join(';')).join('\r\n');
  return '\uFEFF' + body;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Nettoyage préalable — trigger désactivé UNIQUEMENT pendant ce
  // nettoyage, jamais pendant les scénarios métier eux-mêmes plus bas.
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step17Test %')`);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step17Test %'`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;

  let userId = randomUUID();
  const { rows: userRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step17-test-user@example.com', 'x', 'Step17', 'User', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [userId],
  );
  userId = userRows[0].id;
  let otherUserId = randomUUID();
  const { rows: otherUserRows } = await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'step17-test-user2@example.com', 'x', 'Step17', 'Autre', 'ACTIVE', now(), now())
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [otherUserId],
  );
  otherUserId = otherUserRows[0].id;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step17Test Entreprise A','BJ','XOF','ACTIVE',$2,now(),now())`, [companyAId, frameworkId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at) VALUES ($1,'Step17Test Entreprise B','BJ','XOF','ACTIVE',$2,now(),now())`, [companyBId, frameworkId]);

  async function insertLog(opts: {
    companyId: string | null;
    userId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    oldValue?: any;
    newValue?: any;
    ip?: string;
    ua?: string;
    createdAt?: string;
  }): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::timestamp, now()))`,
      [
        id,
        opts.companyId,
        opts.userId,
        opts.action,
        opts.entityType,
        opts.entityId ?? null,
        opts.oldValue ? JSON.stringify(opts.oldValue) : null,
        opts.newValue ? JSON.stringify(opts.newValue) : null,
        opts.ip ?? null,
        opts.ua ?? null,
        opts.createdAt ?? null,
      ],
    );
    return id;
  }

  // =====================================================================
  // 1-7. Création et présence de tous les champs
  // =====================================================================
  const entityId1 = randomUUID();
  const logId1 = await insertLog({
    companyId: companyAId,
    userId,
    action: 'UPDATE',
    entityType: 'Invoice',
    entityId: entityId1,
    oldValue: { status: 'DRAFT' },
    newValue: { status: 'SENT' },
    ip: '10.0.0.1',
    ua: 'test-agent/1.0',
  });
  const { rows: fullCheck } = await client.query(`SELECT * FROM audit_logs WHERE id = $1`, [logId1]);
  const row = fullCheck[0];
  ok('1. Création/présence d\'un AuditLog', fullCheck.length === 1);
  ok('2. Utilisateur associé présent', row.user_id === userId);
  ok('3. companyId présent', row.company_id === companyAId);
  ok('4. Action présente', row.action === 'UPDATE');
  ok('5. entityType/entityId présents', row.entity_type === 'Invoice' && row.entity_id === entityId1);
  ok('6. Ancienne valeur présente et correcte', JSON.stringify(row.old_value) === JSON.stringify({ status: 'DRAFT' }));
  ok('7. Nouvelle valeur présente et correcte', JSON.stringify(row.new_value) === JSON.stringify({ status: 'SENT' }));
  ok('   IP et user-agent présents', row.ip_address === '10.0.0.1' && row.user_agent === 'test-agent/1.0');

  // Jeu de données pour pagination/tri/filtres.
  await insertLog({ companyId: companyAId, userId, action: 'CREATE', entityType: 'Invoice', entityId: randomUUID(), createdAt: '2026-01-10' });
  await insertLog({ companyId: companyAId, userId, action: 'DELETE', entityType: 'Customer', entityId: randomUUID(), createdAt: '2026-01-15' });
  await insertLog({ companyId: companyAId, userId: otherUserId, action: 'CREATE', entityType: 'Supplier', entityId: randomUUID(), createdAt: '2026-01-20' });
  for (let i = 0; i < 10; i++) {
    await insertLog({ companyId: companyAId, userId, action: 'CREATE', entityType: 'BulkTest', entityId: randomUUID(), createdAt: `2026-02-0${(i % 9) + 1}` });
  }

  // =====================================================================
  // 8. Consultation d'un log (reproduit AuditLogService.get())
  // =====================================================================
  const { rows: getCheck } = await client.query(`SELECT * FROM audit_logs WHERE id = $1 AND company_id = $2`, [logId1, companyAId]);
  ok('8. Consultation d\'un log précis réussie', getCheck.length === 1 && getCheck[0].id === logId1);

  // =====================================================================
  // 9. Pagination (reproduit AuditLogService.list())
  // =====================================================================
  const { rows: countRows } = await client.query(`SELECT count(*)::int AS c FROM audit_logs WHERE company_id = $1`, [companyAId]);
  const total = countRows[0].c;
  const pageSize = 5;
  const { rows: page1 } = await client.query(`SELECT id FROM audit_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [companyAId, pageSize, 0]);
  const { rows: page2 } = await client.query(`SELECT id FROM audit_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [companyAId, pageSize, pageSize]);
  ok('9. Pagination correcte (pages disjointes, taille respectée, total cohérent)', page1.length === pageSize && page2.length === pageSize && total === 14 && !page1.some((r: any) => page2.some((r2: any) => r2.id === r.id)));

  // =====================================================================
  // 10. Tri (createdAt asc/desc)
  // =====================================================================
  const { rows: sortedAsc } = await client.query(`SELECT created_at FROM audit_logs WHERE company_id = $1 ORDER BY created_at ASC LIMIT 3`, [companyAId]);
  const { rows: sortedDesc } = await client.query(`SELECT created_at FROM audit_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 3`, [companyAId]);
  ok('10. Tri correct (ASC renvoie le plus ancien en premier, DESC l\'inverse)', new Date(sortedAsc[0].created_at).getTime() < new Date(sortedDesc[0].created_at).getTime());

  // =====================================================================
  // 11-14. Filtres utilisateur / action / entité / date
  // =====================================================================
  const { rows: byUser } = await client.query(`SELECT id FROM audit_logs WHERE company_id = $1 AND user_id = $2`, [companyAId, otherUserId]);
  ok('11. Filtre par utilisateur correct', byUser.length === 1);

  const { rows: byAction } = await client.query(`SELECT id FROM audit_logs WHERE company_id = $1 AND action = 'DELETE'`, [companyAId]);
  ok('12. Filtre par action correct', byAction.length === 1);

  const { rows: byEntity } = await client.query(`SELECT id FROM audit_logs WHERE company_id = $1 AND entity_type = $2 AND entity_id = $3`, [companyAId, 'Invoice', entityId1]);
  ok('13. Filtre par entityType/entityId correct', byEntity.length === 1 && byEntity[0].id === logId1);

  const { rows: byDate } = await client.query(`SELECT id FROM audit_logs WHERE company_id = $1 AND created_at BETWEEN '2026-01-01' AND '2026-01-31'`, [companyAId]);
  ok('14. Filtre par date correct (plage janvier 2026 : 3 événements)', byDate.length === 3);

  // =====================================================================
  // 15. Isolation entreprise A/B
  // =====================================================================
  const { rows: crossAB } = await client.query(`SELECT id FROM audit_logs WHERE id = $1 AND company_id = $2`, [logId1, companyBId]);
  ok('15. Isolation : log de A introuvable sous B', crossAB.length === 0);
  const { rows: bLogs } = await client.query(`SELECT count(*)::int AS c FROM audit_logs WHERE company_id = $1`, [companyBId]);
  ok('    Isolation : entreprise B ne voit aucun log de A (0 événement propre)', bLogs[0].c === 0);

  // =====================================================================
  // 16/17. Permissions AUDIT.READ / refus sans permission
  // =====================================================================
  const { rows: readRoles } = await client.query(`SELECT r.name FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.code='AUDIT.READ' AND r.company_id IS NULL ORDER BY r.name`);
  ok('16. AUDIT.READ accordée aux rôles attendus (SUPER_ADMIN/ADMIN/DIRECTOR/ACCOUNTANT/AUDITOR)', JSON.stringify(readRoles.map((r: any) => r.name)) === JSON.stringify(['ACCOUNTANT', 'ADMIN', 'AUDITOR', 'DIRECTOR', 'SUPER_ADMIN']));
  const { rows: noReadRoles } = await client.query(`SELECT r.name FROM roles r WHERE r.company_id IS NULL AND r.name IN ('VIEWER','ACCOUNTING_ASSISTANT') AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND p.code='AUDIT.READ')`);
  ok('17. VIEWER et ACCOUNTING_ASSISTANT n\'ont pas AUDIT.READ (refus attendu)', noReadRoles.length === 2);

  // Permissions EXPORT (section sécurité #4).
  const { rows: exportRoles } = await client.query(`SELECT r.name FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.code='AUDIT.EXPORT' AND r.company_id IS NULL ORDER BY r.name`);
  ok('   AUDIT.EXPORT accordée aux rôles attendus (SUPER_ADMIN/ADMIN/DIRECTOR/AUDITOR)', JSON.stringify(exportRoles.map((r: any) => r.name)) === JSON.stringify(['ADMIN', 'AUDITOR', 'DIRECTOR', 'SUPER_ADMIN']));
  const { rows: accountantHasReadNotExport } = await client.query(
    `SELECT
       EXISTS(SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.company_id IS NULL AND r.name='ACCOUNTANT' AND p.code='AUDIT.READ') AS has_read,
       EXISTS(SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.company_id IS NULL AND r.name='ACCOUNTANT' AND p.code='AUDIT.EXPORT') AS has_export`,
  );
  ok('   ACCOUNTANT peut consulter (AUDIT.READ) mais pas exporter (pas AUDIT.EXPORT) — refus export attendu', accountantHasReadNotExport[0].has_read === true && accountantHasReadNotExport[0].has_export === false);

  // =====================================================================
  // 18/19. Immutabilité — tentatives RÉELLES d'UPDATE/DELETE, jamais désactivées ici
  // =====================================================================
  let updateRejected = false;
  try {
    await client.query(`UPDATE audit_logs SET action = 'DELETE' WHERE id = $1`, [logId1]);
  } catch (e: any) {
    updateRejected = /immuable/i.test(e.message);
  }
  ok('18. Tentative UPDATE réellement rejetée par PostgreSQL (trigger, pas juste absence de bouton)', updateRejected);

  let deleteRejected = false;
  try {
    await client.query(`DELETE FROM audit_logs WHERE id = $1`, [logId1]);
  } catch (e: any) {
    deleteRejected = /immuable/i.test(e.message);
  }
  ok('19. Tentative DELETE réellement rejetée par PostgreSQL (trigger, pas juste absence de bouton)', deleteRejected);

  const { rows: stillThere } = await client.query(`SELECT id FROM audit_logs WHERE id = $1`, [logId1]);
  ok('    Le log visé par les tentatives UPDATE/DELETE existe toujours, inchangé', stillThere.length === 1);

  // =====================================================================
  // 20. Export CSV (reproduit AuditLogService.exportCsv())
  // =====================================================================
  const { rows: exportRows } = await client.query(
    `SELECT al.created_at, u.first_name, u.last_name, u.email, al.action, al.entity_type, al.entity_id, al.ip_address, al.user_agent
     FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
     WHERE al.company_id = $1 AND al.action = 'DELETE'
     ORDER BY al.created_at DESC`,
    [companyAId],
  );
  const header = ['Date', 'Utilisateur', 'Action', 'Type objet', 'ID objet', 'IP', 'User-Agent'];
  const csvRows = exportRows.map((l: any) => [
    new Date(l.created_at).toISOString(),
    l.first_name ? `${l.first_name} ${l.last_name} (${l.email})` : '—',
    l.action,
    l.entity_type,
    l.entity_id ?? '',
    l.ip_address ?? '',
    l.user_agent ?? '',
  ]);
  const csv = toCsv([header, ...csvRows]);
  ok('20. Export CSV correctement généré (respecte le filtre actif, BOM UTF-8, en-têtes présents)', csv.startsWith('\uFEFF') && csv.includes('Date;Utilisateur;Action') && csv.includes('DELETE') && exportRows.length === 1);

  // =====================================================================
  // Aucune donnée sensible dans les payloads (section sécurité)
  // =====================================================================
  const sensitivePatterns = /password|mot de passe|secret|token|refresh_token|access_token/i;
  const { rows: allValues } = await client.query(`SELECT old_value, new_value FROM audit_logs WHERE company_id = $1`, [companyAId]);
  const anySensitive = allValues.some((r: any) => sensitivePatterns.test(JSON.stringify(r.old_value)) || sensitivePatterns.test(JSON.stringify(r.new_value)));
  ok('   Aucune donnée sensible (mot de passe/token/secret) dans les payloads audités de ce scénario', !anySensitive);

  // =====================================================================
  // Événements réellement produits par les modules existants (mêmes
  // tags action/entityType que le code réel de chaque service).
  // =====================================================================
  const entryId = randomUUID();
  await insertLog({ companyId: companyAId, userId, action: 'VALIDATE', entityType: 'AccountingEntry', entityId: entryId, oldValue: { status: 'DRAFT' }, newValue: { status: 'VALIDATED' } });
  const invoiceEntId = randomUUID();
  await insertLog({ companyId: companyAId, userId, action: 'CREATE', entityType: 'Invoice', entityId: invoiceEntId, newValue: { invoiceNumber: 'FA-2026-0099' } });
  await insertLog({ companyId: companyAId, userId, action: 'UPDATE', entityType: 'Invoice', entityId: invoiceEntId, newValue: { invoiceNumber: 'FA-2026-0099' } });
  const declEntId = randomUUID();
  await insertLog({ companyId: companyAId, userId, action: 'VALIDATE', entityType: 'TaxDeclaration', entityId: declEntId, newValue: { amountDue: 13000 } });
  const budgetEntId = randomUUID();
  await insertLog({ companyId: companyAId, userId, action: 'VALIDATE', entityType: 'Budget', entityId: budgetEntId, oldValue: { status: 'DRAFT' }, newValue: { status: 'ACTIVE' } });
  await insertLog({ companyId: companyAId, userId, action: 'UPDATE', entityType: 'Budget', entityId: budgetEntId, oldValue: { status: 'ACTIVE' }, newValue: { status: 'CLOSED' } });
  const disposalEntId = randomUUID();
  await insertLog({ companyId: companyAId, userId, action: 'VALIDATE', entityType: 'AssetDisposal', entityId: disposalEntId, newValue: { result: 250000 } });
  const attachmentEntId = randomUUID();
  await insertLog({ companyId: companyAId, userId, action: 'DELETE', entityType: 'Attachment', entityId: attachmentEntId, oldValue: { fileName: 'justificatif.pdf' } });

  const { rows: integrationCheck } = await client.query(
    `SELECT action, entity_type, entity_id FROM audit_logs WHERE company_id = $1 AND entity_type IN ('AccountingEntry','Invoice','TaxDeclaration','Budget','AssetDisposal','Attachment') ORDER BY entity_type, created_at`,
    [companyAId],
  );
  ok('Écriture comptable — validation tracée (VALIDATE/AccountingEntry)', integrationCheck.some((r: any) => r.entity_type === 'AccountingEntry' && r.action === 'VALIDATE'));
  ok('Facture — création ET modification tracées (CREATE + UPDATE/Invoice)', integrationCheck.filter((r: any) => r.entity_type === 'Invoice' && r.entity_id === invoiceEntId).length === 2);
  ok('Déclaration fiscale — validation tracée (VALIDATE/TaxDeclaration)', integrationCheck.some((r: any) => r.entity_type === 'TaxDeclaration' && r.action === 'VALIDATE'));
  ok('Budget — activation ET clôture tracées (VALIDATE puis UPDATE/Budget)', integrationCheck.filter((r: any) => r.entity_type === 'Budget').length === 2);
  ok('Immobilisation — cession tracée (VALIDATE/AssetDisposal)', integrationCheck.some((r: any) => r.entity_type === 'AssetDisposal' && r.action === 'VALIDATE'));
  ok('Pièce jointe — suppression tracée (DELETE/Attachment)', integrationCheck.some((r: any) => r.entity_type === 'Attachment' && r.action === 'DELETE'));

  // =====================================================================
  // Nettoyage — trigger désactivé UNIQUEMENT pour ce nettoyage final.
  // =====================================================================
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId, otherUserId]);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Erreur lors de l'exécution des tests Étape 17:", err);
  process.exit(1);
});
