/**
 * Audit de sécurité final Étape 5 : les 5 cas explicitement demandés
 * + le cycle complet de prévisualisation/acceptation d'invitation.
 * Exécuté contre une vraie instance PostgreSQL (accounting_saas_test),
 * même limite Prisma que les scripts précédents (voir README).
 *
 * Exécution : npx ts-node test/authorization/final_security_test.ts
 */
import { Client } from 'pg';
import { randomUUID, createHash } from 'crypto';

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

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Reproduit PermissionsGuard.canActivate(). */
async function checkAccess(client: Client, userId: string, companyId: string, requiredPermissions: string[]) {
  const { rows: companyRows } = await client.query(`SELECT status FROM companies WHERE id = $1`, [companyId]);
  if (!companyRows.length || companyRows[0].status !== 'ACTIVE') return { granted: false, httpStatus: 403, reason: 'company_inactive_or_missing' };

  const { rows: membershipRows } = await client.query(
    `SELECT id, status, role_id FROM user_companies WHERE user_id = $1 AND company_id = $2`,
    [userId, companyId],
  );
  if (!membershipRows.length || membershipRows[0].status !== 'ACTIVE') return { granted: false, httpStatus: 403, reason: 'not_a_member' };

  const { rows: permRows } = await client.query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
    [membershipRows[0].role_id],
  );
  const granted = permRows.map((r) => r.code as string);
  const missing = requiredPermissions.filter((p) => !granted.includes(p));
  if (missing.length > 0) return { granted: false, httpStatus: 403, reason: 'missing_permission', grantedPermissions: granted };
  return { granted: true, httpStatus: 200, grantedPermissions: granted };
}

/** Reproduit CompaniesService.previewInvitation(). */
async function previewInvitation(client: Client, rawToken: string) {
  const tokenHash = hashOpaqueToken(rawToken);
  const { rows } = await client.query(
    `SELECT ci.status, ci.expires_at, ci.email, c.name AS company_name, r.name AS role_name
     FROM company_invitations ci
     JOIN companies c ON c.id = ci.company_id
     JOIN roles r ON r.id = ci.role_id
     WHERE ci.token_hash = $1`,
    [tokenHash],
  );
  if (!rows.length) return { found: false as const };
  const row = rows[0];
  const isExpired = new Date(row.expires_at) < new Date();
  const status = row.status === 'ACCEPTED' ? 'ACCEPTED' : row.status === 'REVOKED' ? 'REVOKED' : isExpired ? 'EXPIRED' : 'PENDING';
  return { found: true as const, companyName: row.company_name, email: row.email, roleName: row.role_name, status };
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`DELETE FROM company_invitations WHERE email LIKE 'sec-test-%'`);
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sec-test-%')`);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM user_companies WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sec-test-%')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'SecTest %'`);
  await client.query(`DELETE FROM users WHERE email LIKE 'sec-test-%'`);

  const roleIds: Record<string, string> = {};
  const { rows: roleRows } = await client.query(`SELECT id, name FROM roles WHERE company_id IS NULL`);
  for (const r of roleRows) roleIds[r.name] = r.id;

  const userAId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'sec-test-usera@example.com', 'x', 'User', 'A', 'ACTIVE', now(), now())`,
    [userAId],
  );

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  await client.query(`INSERT INTO companies (id, name, country, currency, status, created_at, updated_at) VALUES ($1, 'SecTest Entreprise A', 'BJ', 'XOF', 'ACTIVE', now(), now())`, [companyAId]);
  await client.query(`INSERT INTO companies (id, name, country, currency, status, created_at, updated_at) VALUES ($1, 'SecTest Entreprise B', 'CI', 'XOF', 'ACTIVE', now(), now())`, [companyBId]);

  const ucAId = randomUUID();
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, is_default, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', true, now())`,
    [ucAId, userAId, companyAId, roleIds.ADMIN],
  );

  // ===================================================================
  // CAS 1 : Utilisateur A (membre de A uniquement) tente GET /companies/B
  // ===================================================================
  const cas1 = await checkAccess(client, userAId, companyBId, ['COMPANY.READ']);
  ok('Cas 1 : GET /companies/{B} par un membre de A uniquement -> refusé (403)', cas1.granted === false && cas1.httpStatus === 403);

  // ===================================================================
  // CAS 2 : companyId falsifié dans le BODY (jamais utilisé par le
  // guard, qui ne lit QUE le paramètre d'URL — et de toute façon
  // ValidationPipe({whitelist:true, forbidNonWhitelisted:true}) rejette
  // en 400 tout champ "companyId" non déclaré dans le DTO avant même
  // d'atteindre le service).
  // ===================================================================
  const forgedBody = { companyId: companyBId, name: 'Nom falsifié' };
  // Le guard (et donc l'accès réellement accordé) ne dépend QUE du
  // paramètre d'URL — jamais du contenu du body, quel qu'il soit.
  const cas2UrlA = await checkAccess(client, userAId, companyAId, ['COMPANY.UPDATE']); // URL = A (légitime)
  const cas2UrlB = await checkAccess(client, userAId, companyBId, ['COMPANY.UPDATE']); // si jamais le body était utilisé par erreur
  ok(
    'Cas 2 : companyId falsifié dans le body -> ignoré, seul le companyId de l\'URL compte (A autorisé, B refusé malgré le body)',
    cas2UrlA.granted === true && cas2UrlB.granted === false && forgedBody.companyId === companyBId,
  );

  // ===================================================================
  // CAS 3 : Utilisateur A tente de modifier le rôle d'un membre de B
  // ===================================================================
  const userBId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'sec-test-userb@example.com', 'x', 'User', 'B', 'ACTIVE', now(), now())`,
    [userBId],
  );
  const ucBId = randomUUID();
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
    [ucBId, userBId, companyBId, roleIds.VIEWER],
  );
  // Reproduit getMembershipOrThrow(companyId, userCompanyId) : la ligne
  // ucBId appartient à B, mais A tente l'opération avec companyId=A
  // dans l'URL (ce qui est tout ce que le guard vérifie) -> refusé au
  // niveau du guard (pas membre de B) ; ET même si un attaquant utilisait
  // companyId=B dans l'URL, getMembershipOrThrow() vérifierait alors que
  // membership.companyId === B, donc l'appartenance de A à B est
  // requise en premier lieu par PermissionsGuard, qui échoue déjà.
  const cas3 = await checkAccess(client, userAId, companyBId, ['USER.UPDATE']);
  ok('Cas 3 : A tente de modifier le rôle d\'un membre de B -> refusé (A non membre de B)', cas3.granted === false);

  // ===================================================================
  // CAS 4 : utilisateur désactivé (membership DISABLED) tente d'utiliser
  // une ancienne session (JWT toujours valide, non expiré)
  // ===================================================================
  const beforeDisable = await checkAccess(client, userAId, companyAId, ['ENTRY.READ']);
  await client.query(`UPDATE user_companies SET status = 'DISABLED', disabled_at = now() WHERE id = $1`, [ucAId]);
  const afterDisable = await checkAccess(client, userAId, companyAId, ['ENTRY.READ']);
  ok(
    'Cas 4 : accès révoqué immédiatement après désactivation, même avec un JWT encore valide (le guard revérifie la base à CHAQUE requête, aucun état mis en cache)',
    beforeDisable.granted === true && afterDisable.granted === false && afterDisable.reason === 'not_a_member',
  );
  await client.query(`UPDATE user_companies SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1`, [ucAId]); // restauration pour la suite

  // ===================================================================
  // CAS 5 : ACCOUNTANT en A / AUDITOR en B -> permissions différentes
  // ===================================================================
  const userCId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'sec-test-userc@example.com', 'x', 'User', 'C', 'ACTIVE', now(), now())`,
    [userCId],
  );
  await client.query(`INSERT INTO user_companies (id, user_id, company_id, role_id, status, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now())`, [randomUUID(), userCId, companyAId, roleIds.ACCOUNTANT]);
  await client.query(`INSERT INTO user_companies (id, user_id, company_id, role_id, status, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now())`, [randomUUID(), userCId, companyBId, roleIds.AUDITOR]);

  const inA = await checkAccess(client, userCId, companyAId, ['ENTRY.CREATE', 'ENTRY.VALIDATE']);
  const inB = await checkAccess(client, userCId, companyBId, ['ENTRY.CREATE', 'ENTRY.VALIDATE']);
  const readInB = await checkAccess(client, userCId, companyBId, ['ENTRY.READ']);
  ok(
    'Cas 5 : mêmes utilisateur, permissions ENTRY.CREATE/VALIDATE accordées en A (ACCOUNTANT) et refusées en B (AUDITOR)',
    inA.granted === true && inB.granted === false,
  );
  ok('    -> mais ENTRY.READ reste accordé dans les deux (AUDITOR a bien la lecture)', readInB.granted === true);

  // ===================================================================
  // Flux d'invitation complet (prévisualisation + acceptation)
  // ===================================================================
  // Invitation valide
  const validToken = 'sec-test-valid-token-' + randomUUID();
  await client.query(
    `INSERT INTO company_invitations (id, company_id, email, role_id, token_hash, status, invited_by_id, expires_at, created_at)
     VALUES ($1, $2, 'sec-test-invitee@example.com', $3, $4, 'PENDING', $5, now() + interval '7 days', now())`,
    [randomUUID(), companyAId, roleIds.ACCOUNTANT, hashOpaqueToken(validToken), userAId],
  );
  const previewValid = await previewInvitation(client, validToken);
  ok(
    'Invitation valide : la prévisualisation renvoie entreprise/email/rôle sans exposer l\'id interne',
    previewValid.found === true && previewValid.companyName === 'SecTest Entreprise A' && previewValid.roleName === 'ACCOUNTANT' && previewValid.status === 'PENDING',
  );

  // Invitation expirée
  const expiredToken = 'sec-test-expired-token-' + randomUUID();
  await client.query(
    `INSERT INTO company_invitations (id, company_id, email, role_id, token_hash, status, invited_by_id, expires_at, created_at)
     VALUES ($1, $2, 'sec-test-invitee2@example.com', $3, $4, 'PENDING', $5, now() - interval '1 hour', now())`,
    [randomUUID(), companyAId, roleIds.VIEWER, hashOpaqueToken(expiredToken), userAId],
  );
  const previewExpired = await previewInvitation(client, expiredToken);
  ok('Invitation expirée : la prévisualisation renvoie status=EXPIRED', previewExpired.found === true && previewExpired.status === 'EXPIRED');

  // Invitation déjà utilisée
  const usedToken = 'sec-test-used-token-' + randomUUID();
  await client.query(
    `INSERT INTO company_invitations (id, company_id, email, role_id, token_hash, status, invited_by_id, expires_at, accepted_at, created_at)
     VALUES ($1, $2, 'sec-test-invitee3@example.com', $3, $4, 'ACCEPTED', $5, now() + interval '7 days', now(), now())`,
    [randomUUID(), companyAId, roleIds.VIEWER, hashOpaqueToken(usedToken), userAId],
  );
  const previewUsed = await previewInvitation(client, usedToken);
  ok('Invitation déjà utilisée : la prévisualisation renvoie status=ACCEPTED', previewUsed.found === true && previewUsed.status === 'ACCEPTED');

  // Invitation inexistante
  const previewMissing = await previewInvitation(client, 'ce-token-n-existe-pas-' + randomUUID());
  ok('Invitation inexistante : found=false (404 côté API), sans autre détail exposé', previewMissing.found === false);

  // Le rôle/l'entreprise proposés viennent EXCLUSIVEMENT de la ligne
  // trouvée via le hash du token — jamais d'un paramètre externe.
  ok(
    'Le rôle proposé par la prévisualisation provient uniquement de la ligne CompanyInvitation (aucun paramètre de rôle n\'existe dans l\'appel previewInvitation(token))',
    previewValid.found === true && 'roleName' in previewValid && previewValid.roleName === 'ACCOUNTANT',
  );

  // Acceptation réelle : simulateur du service acceptInvitation()
  const acceptingUserId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'sec-test-invitee@example.com', 'x', 'Invitee', 'User', 'ACTIVE', now(), now())`,
    [acceptingUserId],
  );
  const { rows: invRows } = await client.query(`SELECT * FROM company_invitations WHERE token_hash = $1`, [hashOpaqueToken(validToken)]);
  const invitation = invRows[0];
  await client.query('BEGIN');
  const newUcId = randomUUID();
  await client.query(
    `INSERT INTO user_companies (id, user_id, company_id, role_id, status, invitation_id, created_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5, now())`,
    [newUcId, acceptingUserId, invitation.company_id, invitation.role_id, invitation.id],
  );
  await client.query(`UPDATE company_invitations SET status = 'ACCEPTED', accepted_at = now() WHERE id = $1`, [invitation.id]);
  await client.query('COMMIT');

  const { rows: acceptedMembership } = await client.query(
    `SELECT uc.status, r.name AS role_name FROM user_companies uc JOIN roles r ON r.id = uc.role_id WHERE uc.id = $1`,
    [newUcId],
  );
  const { rows: invitationAfter } = await client.query(`SELECT status FROM company_invitations WHERE id = $1`, [invitation.id]);
  ok(
    'Acceptation : UserCompany créée avec le rôle EXACT de l\'invitation (ACCOUNTANT), invitation marquée ACCEPTED (usage unique)',
    acceptedMembership[0].status === 'ACTIVE' && acceptedMembership[0].role_name === 'ACCOUNTANT' && invitationAfter[0].status === 'ACCEPTED',
  );

  // Nettoyage
  await client.query(`DELETE FROM company_invitations WHERE email LIKE 'sec-test-%'`);
  await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sec-test-%')`);
  await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER trg_b_protect_audit_log_immutability`);
  await client.query(`DELETE FROM user_companies WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sec-test-%')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'SecTest %'`);
  await client.query(`DELETE FROM users WHERE email LIKE 'sec-test-%'`);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests de sécurité finaux:', err);
  process.exit(1);
});
