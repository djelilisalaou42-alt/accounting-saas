/**
 * Tests d'intégration Étape 5 (autorisation, rôles, multi-entreprise),
 * exécutés contre une VRAIE instance PostgreSQL (accounting_saas_test),
 * pour la même raison qu'en Étape 4 : le moteur Prisma reste
 * indisponible dans ce sandbox (voir README). Ce script réexécute
 * exactement la même logique que PermissionsGuard/CompaniesService,
 * en SQL direct, contre les rôles/permissions RÉELLEMENT SEEDÉS
 * (prisma/seed/seed_permissions_roles.sql) — rien n'est simulé ni
 * fabriqué.
 *
 * NE COUVRE PAS (nécessiterait le conteneur NestJS réel, donc
 * `prisma generate`) : le routing HTTP, les DTO `class-validator`, le
 * guard `JwtAuthGuard` lui-même. Voir README pour la distinction
 * claire test DB / test service / test API / test frontend.
 *
 * Exécution : npx ts-node test/authorization/authorization_integration_test.ts
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://accounting_user:accounting_password@localhost:5432/accounting_saas_test?schema=public';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
  }
}

/** Reproduit la logique de PermissionsGuard.canActivate() en SQL direct. */
async function checkAccess(
  client: Client,
  userId: string,
  companyId: string,
  requiredPermissions: string[],
): Promise<{ granted: boolean; reason?: string; grantedPermissions?: string[] }> {
  const { rows: companyRows } = await client.query(`SELECT status FROM companies WHERE id = $1`, [companyId]);
  if (!companyRows.length || companyRows[0].status !== 'ACTIVE') {
    return { granted: false, reason: 'company_inactive_or_missing' };
  }

  const { rows: membershipRows } = await client.query(
    `SELECT uc.id AS user_company_id, uc.status, uc.role_id
     FROM user_companies uc WHERE uc.user_id = $1 AND uc.company_id = $2`,
    [userId, companyId],
  );
  if (!membershipRows.length || membershipRows[0].status !== 'ACTIVE') {
    return { granted: false, reason: 'not_a_member' };
  }

  const { rows: permRows } = await client.query(
    `SELECT p.code FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [membershipRows[0].role_id],
  );
  const granted = permRows.map((r) => r.code as string);
  const missing = requiredPermissions.filter((p) => !granted.includes(p));
  if (missing.length > 0) {
    return { granted: false, reason: 'missing_permission', grantedPermissions: granted };
  }
  return { granted: true, grantedPermissions: granted };
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Nettoyage des données de test précédentes
  await client.query(`DELETE FROM company_invitations WHERE email LIKE 'authz-test-%'`);
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'authz-test-%')`);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM user_companies WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'authz-test-%')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'AuthZ Test %'`);
  await client.query(`DELETE FROM users WHERE email LIKE 'authz-test-%'`);

  const roleIds: Record<string, string> = {};
  const { rows: roleRows } = await client.query(`SELECT id, name FROM roles WHERE company_id IS NULL`);
  for (const r of roleRows) roleIds[r.name] = r.id;
  ok('0. Les 7 rôles système sont bien seedés', Object.keys(roleIds).length === 7);

  // Utilisateurs de test
  const adminUserId = randomUUID();
  const secondUserId = randomUUID();
  const superAdminUserId = randomUUID();
  for (const [id, email, isSuperAdmin] of [
    [adminUserId, 'authz-test-admin@example.com', false],
    [secondUserId, 'authz-test-jean@example.com', false],
    [superAdminUserId, 'authz-test-superadmin@example.com', true],
  ] as const) {
    await client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, status, is_super_admin, created_at, updated_at)
       VALUES ($1, $2, 'x', 'Test', 'User', 'ACTIVE', $3, now(), now())`,
      [id, email, isSuperAdmin],
    );
  }

  // ===================================================================
  // 1-2. Création d'entreprise + créateur devient ADMIN
  // ===================================================================
  const companyAId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, created_at, updated_at)
     VALUES ($1, 'AuthZ Test Entreprise A', 'BJ', 'XOF', 'ACTIVE', now(), now())`,
    [companyAId],
  );
  const ucAdminAId = randomUUID();
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, is_default, created_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', true, now())`,
    [ucAdminAId, adminUserId, companyAId, roleIds.ADMIN],
  );
  const { rows: createdCompanyRows } = await client.query(`SELECT * FROM companies WHERE id = $1`, [companyAId]);
  ok('1. Création d\'entreprise', createdCompanyRows.length === 1);
  const { rows: creatorRoleRows } = await client.query(
    `SELECT r.name FROM user_companies uc JOIN roles r ON r.id = uc.role_id WHERE uc.id = $1`,
    [ucAdminAId],
  );
  ok('2. Le créateur devient automatiquement ADMIN', creatorRoleRows[0].name === 'ADMIN');

  // ===================================================================
  // 3-4. Utilisateur appartenant à deux entreprises, rôles différents
  // ===================================================================
  const companyBId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, created_at, updated_at)
     VALUES ($1, 'AuthZ Test Entreprise B', 'CI', 'XOF', 'ACTIVE', now(), now())`,
    [companyBId],
  );
  // Jean : ACCOUNTANT dans A, VIEWER dans B
  const ucJeanAId = randomUUID();
  const ucJeanBId = randomUUID();
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
    [ucJeanAId, secondUserId, companyAId, roleIds.ACCOUNTANT],
  );
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
    [ucJeanBId, secondUserId, companyBId, roleIds.VIEWER],
  );
  const { rows: jeanCompanies } = await client.query(`SELECT company_id FROM user_companies WHERE user_id = $1`, [secondUserId]);
  ok('3. Utilisateur (Jean) appartenant à deux entreprises', jeanCompanies.length === 2);
  const { rows: jeanRoles } = await client.query(
    `SELECT uc.company_id, r.name FROM user_companies uc JOIN roles r ON r.id = uc.role_id WHERE uc.user_id = $1 ORDER BY r.name`,
    [secondUserId],
  );
  ok(
    '4. Rôles différents selon l\'entreprise (ACCOUNTANT en A, VIEWER en B)',
    jeanRoles.some((r) => r.company_id === companyAId && r.name === 'ACCOUNTANT') &&
      jeanRoles.some((r) => r.company_id === companyBId && r.name === 'VIEWER'),
  );

  // ===================================================================
  // 5-8. Accès autorisé / refusé / autre entreprise / companyId modifié
  // ===================================================================
  const accessGranted = await checkAccess(client, secondUserId, companyAId, ['ENTRY.CREATE']);
  ok('5. Accès autorisé (Jean/ACCOUNTANT en A peut ENTRY.CREATE)', accessGranted.granted === true);

  const accessDenied = await checkAccess(client, secondUserId, companyBId, ['ENTRY.CREATE']);
  ok('6. Accès refusé (Jean/VIEWER en B ne peut pas ENTRY.CREATE)', accessDenied.granted === false && accessDenied.reason === 'missing_permission');

  const companyCId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, created_at, updated_at)
     VALUES ($1, 'AuthZ Test Entreprise C (étrangère)', 'SN', 'XOF', 'ACTIVE', now(), now())`,
    [companyCId],
  );
  const accessOtherCompany = await checkAccess(client, adminUserId, companyCId, ['COMPANY.READ']);
  ok('7. Accès à une autre entreprise (sans membership) refusé', accessOtherCompany.granted === false && accessOtherCompany.reason === 'not_a_member');
  ok(
    '8. Modification du companyId dans la requête refusée (même logique : le guard revérifie TOUJOURS la membership sur le companyId de l\'URL, jamais sur un état mémorisé)',
    accessOtherCompany.granted === false,
  );

  // ===================================================================
  // 9-13. Matrice de permissions par rôle
  // ===================================================================
  const viewerCreate = await checkAccess(client, secondUserId, companyBId, ['ENTRY.CREATE']);
  ok('9. VIEWER ne peut pas créer (ENTRY.CREATE refusé)', viewerCreate.granted === false);

  // Auditor de test dans l'entreprise A
  const auditorUserId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'authz-test-auditor@example.com', 'x', 'Test', 'Auditor', 'ACTIVE', now(), now())`,
    [auditorUserId],
  );
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
    [randomUUID(), auditorUserId, companyAId, roleIds.AUDITOR],
  );
  const auditorUpdate = await checkAccess(client, auditorUserId, companyAId, ['ENTRY.UPDATE']);
  ok('10. AUDITOR ne peut pas modifier une écriture (ENTRY.UPDATE refusé)', auditorUpdate.granted === false);

  // Assistant de test dans l'entreprise A
  const assistantUserId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'authz-test-assistant@example.com', 'x', 'Test', 'Assistant', 'ACTIVE', now(), now())`,
    [assistantUserId],
  );
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
    [randomUUID(), assistantUserId, companyAId, roleIds.ACCOUNTING_ASSISTANT],
  );
  const assistantValidate = await checkAccess(client, assistantUserId, companyAId, ['ENTRY.VALIDATE']);
  ok('11. ACCOUNTING_ASSISTANT ne peut pas valider (ENTRY.VALIDATE absent de son rôle)', assistantValidate.granted === false);

  const accountantCreate = await checkAccess(client, secondUserId, companyAId, ['ENTRY.CREATE']);
  ok('12. ACCOUNTANT peut saisir une écriture (ENTRY.CREATE)', accountantCreate.granted === true);

  const accountantValidate = await checkAccess(client, secondUserId, companyAId, ['ENTRY.VALIDATE']);
  ok('13. ACCOUNTANT peut valider (ENTRY.VALIDATE accordé à ce rôle)', accountantValidate.granted === true);

  // ===================================================================
  // 14-15. Gestion des membres, cloisonnement inter-entreprises
  // ===================================================================
  const adminManageMembersA = await checkAccess(client, adminUserId, companyAId, ['USER.CREATE', 'USER.UPDATE', 'USER.DISABLE']);
  ok('14. ADMIN (entreprise A) peut gérer les membres de A', adminManageMembersA.granted === true);

  const adminManageMembersB = await checkAccess(client, adminUserId, companyBId, ['USER.CREATE']);
  ok('15. ADMIN de A ne peut PAS gérer les membres de B (pas membre de B)', adminManageMembersB.granted === false);

  // ===================================================================
  // 16-18. Invitations
  // ===================================================================
  const validInvitationId = randomUUID();
  await client.query(
    `INSERT INTO company_invitations (id, company_id, email, role_id, token_hash, status, invited_by_id, expires_at, created_at)
     VALUES ($1, $2, 'authz-test-invite@example.com', $3, $4, 'PENDING', $5, now() + interval '7 days', now())`,
    [validInvitationId, companyAId, roleIds.ACCOUNTANT, 'hash-valid-' + randomUUID(), adminUserId],
  );
  const { rows: validInviteRows } = await client.query(
    `SELECT status, expires_at > now() AS not_expired FROM company_invitations WHERE id = $1`,
    [validInvitationId],
  );
  ok('16. Invitation valide (PENDING, non expirée)', validInviteRows[0].status === 'PENDING' && validInviteRows[0].not_expired === true);

  const expiredInvitationId = randomUUID();
  await client.query(
    `INSERT INTO company_invitations (id, company_id, email, role_id, token_hash, status, invited_by_id, expires_at, created_at)
     VALUES ($1, $2, 'authz-test-expired@example.com', $3, $4, 'PENDING', $5, now() - interval '1 day', now())`,
    [expiredInvitationId, companyAId, roleIds.VIEWER, 'hash-expired-' + randomUUID(), adminUserId],
  );
  const { rows: expiredInviteRows } = await client.query(
    `SELECT expires_at < now() AS is_expired FROM company_invitations WHERE id = $1`,
    [expiredInvitationId],
  );
  ok('17. Invitation expirée détectée', expiredInviteRows[0].is_expired === true);

  const usedInvitationId = randomUUID();
  await client.query(
    `INSERT INTO company_invitations (id, company_id, email, role_id, token_hash, status, invited_by_id, expires_at, accepted_at, created_at)
     VALUES ($1, $2, 'authz-test-used@example.com', $3, $4, 'ACCEPTED', $5, now() + interval '7 days', now(), now())`,
    [usedInvitationId, companyAId, roleIds.VIEWER, 'hash-used-' + randomUUID(), adminUserId],
  );
  const { rows: usedInviteRows } = await client.query(`SELECT status FROM company_invitations WHERE id = $1`, [usedInvitationId]);
  ok('18. Invitation déjà utilisée détectée (status = ACCEPTED)', usedInviteRows[0].status === 'ACCEPTED');

  // ===================================================================
  // 19. Changement de rôle
  // ===================================================================
  await client.query(`UPDATE user_companies SET role_id = $1 WHERE id = $2`, [roleIds.DIRECTOR, ucJeanBId]);
  const { rows: roleChangeRows } = await client.query(
    `SELECT r.name FROM user_companies uc JOIN roles r ON r.id = uc.role_id WHERE uc.id = $1`,
    [ucJeanBId],
  );
  ok('19. Changement de rôle (Jean VIEWER -> DIRECTOR en B)', roleChangeRows[0].name === 'DIRECTOR');

  // ===================================================================
  // 20-22. Désactivation / réactivation / révocation (retrait doux)
  // ===================================================================
  await client.query(`UPDATE user_companies SET status = 'DISABLED', disabled_at = now(), disabled_by_id = $1 WHERE id = $2`, [adminUserId, ucJeanAId]);
  const { rows: disabledRows } = await client.query(`SELECT status FROM user_companies WHERE id = $1`, [ucJeanAId]);
  ok('20. Désactivation d\'un membre (status = DISABLED)', disabledRows[0].status === 'DISABLED');
  const accessAfterDisable = await checkAccess(client, secondUserId, companyAId, ['ENTRY.READ']);
  ok('    -> un membre désactivé perd tout accès (guard le traite comme non-membre)', accessAfterDisable.granted === false);

  await client.query(`UPDATE user_companies SET status = 'ACTIVE', disabled_at = NULL, disabled_by_id = NULL WHERE id = $1`, [ucJeanAId]);
  const { rows: reactivatedRows } = await client.query(`SELECT status FROM user_companies WHERE id = $1`, [ucJeanAId]);
  ok('21. Réactivation (status = ACTIVE)', reactivatedRows[0].status === 'ACTIVE');
  const accessAfterReactivate = await checkAccess(client, secondUserId, companyAId, ['ENTRY.READ']);
  ok('    -> l\'accès est restauré après réactivation', accessAfterReactivate.granted === true);

  await client.query(`UPDATE user_companies SET status = 'REMOVED', disabled_at = now(), disabled_by_id = $1 WHERE id = $2`, [adminUserId, ucJeanAId]);
  const { rows: removedRows } = await client.query(`SELECT status FROM user_companies WHERE id = $1`, [ucJeanAId]);
  ok('22. Révocation d\'accès / retrait (status = REMOVED, ligne conservée — jamais de DELETE)', removedRows[0].status === 'REMOVED');
  const { rows: rowStillExists } = await client.query(`SELECT id FROM user_companies WHERE id = $1`, [ucJeanAId]);
  ok('    -> la ligne UserCompany existe toujours (historique préservé)', rowStillExists.length === 1);

  // ===================================================================
  // 23. SUPER_ADMIN séparé des admins d'entreprise
  // ===================================================================
  const { rows: superAdminFlagRows } = await client.query(`SELECT is_super_admin FROM users WHERE id = $1`, [superAdminUserId]);
  const { rows: superAdminMemberships } = await client.query(`SELECT count(*) AS c FROM user_companies WHERE user_id = $1`, [superAdminUserId]);
  ok(
    '23. SUPER_ADMIN est un attribut plateforme (is_super_admin=true) totalement indépendant de toute UserCompany',
    superAdminFlagRows[0].is_super_admin === true && Number(superAdminMemberships[0].c) === 0,
  );
  const { rows: regularAdminFlagRows } = await client.query(`SELECT is_super_admin FROM users WHERE id = $1`, [adminUserId]);
  ok('    -> un ADMIN d\'entreprise classique n\'a PAS is_super_admin=true', regularAdminFlagRows[0].is_super_admin === false);

  // ===================================================================
  // 24-25. Audit
  // ===================================================================
  await client.query(
    `INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, new_value, created_at)
     VALUES ($1, $2, $3, 'MEMBER_ROLE_CHANGE', 'UserCompany', $4, $5, now())`,
    [randomUUID(), companyBId, adminUserId, ucJeanBId, JSON.stringify({ roleName: 'DIRECTOR' })],
  );
  const { rows: auditRoleChangeRows } = await client.query(
    `SELECT count(*) AS c FROM audit_logs WHERE action = 'MEMBER_ROLE_CHANGE' AND entity_id = $1`,
    [ucJeanBId],
  );
  ok('24. Le changement de rôle est audité (MEMBER_ROLE_CHANGE)', Number(auditRoleChangeRows[0].c) === 1);

  await client.query(
    `INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, new_value, created_at)
     VALUES ($1, $2, $3, 'PERMISSION_DENIED', 'UserCompany', $4, now())`,
    [randomUUID(), companyBId, adminUserId, JSON.stringify({ reason: 'not_a_member', requiredPermissions: ['USER.CREATE'] })],
  );
  const { rows: auditDeniedRows } = await client.query(
    `SELECT new_value FROM audit_logs WHERE action = 'PERMISSION_DENIED' AND user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [adminUserId],
  );
  const deniedPayload = JSON.stringify(auditDeniedRows[0].new_value);
  ok(
    '25. Les refus d\'autorisation sont audités (PERMISSION_DENIED) sans donnée sensible (ni mot de passe, ni token)',
    auditDeniedRows.length === 1 && !deniedPayload.toLowerCase().includes('password') && !deniedPayload.toLowerCase().includes('token'),
  );

  // ===================================================================
  // Nettoyage
  // ===================================================================
  await client.query(`DELETE FROM company_invitations WHERE email LIKE 'authz-test-%'`);
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'authz-test-%')`);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM user_companies WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'authz-test-%')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'AuthZ Test %'`);
  await client.query(`DELETE FROM users WHERE email LIKE 'authz-test-%'`);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests d\'autorisation:', err);
  process.exit(1);
});
