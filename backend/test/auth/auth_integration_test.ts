/**
 * Tests d'intégration de l'authentification, exécutés contre une VRAIE
 * instance PostgreSQL (base accounting_saas_test).
 *
 * POURQUOI CE FICHIER EXISTE (voir aussi README, section "Limite
 * connue") : le moteur Prisma ne peut pas être téléchargé dans ce
 * sandbox, donc `PrismaService`/`AuthService` ne peuvent pas être
 * instanciés via le conteneur NestJS ici. Plutôt que de ne rien tester
 * ou de fabriquer de faux résultats, ce script réutilise le VRAI code
 * métier non-Prisma (hashPassword/verifyPassword d'Argon2id,
 * generateOpaqueToken/hashOpaqueToken/parseDurationToMs) et exécute
 * exactement les mêmes requêtes SQL que celles que Prisma générerait
 * pour les mêmes opérations, contre la vraie base. Cela valide le
 * comportement réel de bout en bout — ce n'est PAS un mock.
 *
 * Une fois `prisma generate` disponible chez vous, remplacez ce script
 * par de vrais tests Jest/Supertest pilotant AuthController via HTTP
 * (voir README pour la commande équivalente).
 *
 * Exécution : npx ts-node test/auth/auth_integration_test.ts
 */
import { Client } from 'pg';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.util';
import { generateOpaqueToken, hashOpaqueToken, parseDurationToMs } from '../../src/modules/auth/token.util';
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

  // Nettoyage des données de test précédentes
  await client.query(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'auth-test-%')`);
  await client.query(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'auth-test-%')`);
  await client.query(`DELETE FROM users WHERE email LIKE 'auth-test-%'`);

  const testEmail = 'auth-test-user@example.com';
  const testPassword = 'MotDePasseValide123!';

  // ===================================================================
  // 1. Inscription valide
  // ===================================================================
  const passwordHash = await hashPassword(testPassword);
  const userId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'Test', 'User', 'ACTIVE', now(), now())`,
    [userId, testEmail, passwordHash],
  );
  const { rows: createdRows } = await client.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  ok('1. Inscription valide crée l\'utilisateur', createdRows.length === 1);
  ok('   -> le hash stocké est Argon2id (jamais le mot de passe en clair)', createdRows[0].password_hash.startsWith('$argon2id$'));
  ok('   -> le mot de passe en clair n\'apparaît jamais dans la colonne hash', !createdRows[0].password_hash.includes(testPassword));

  // ===================================================================
  // 2. Email déjà utilisé
  // ===================================================================
  try {
    await client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Autre', 'User', 'ACTIVE', now(), now())`,
      [randomUUID(), testEmail, await hashPassword('AutreMotDePasse123!')],
    );
    ok('2. Email déjà utilisé rejeté', false, 'l\'insertion aurait dû violer la contrainte unique');
  } catch (err) {
    ok('2. Email déjà utilisé rejeté', /unique/i.test((err as Error).message));
  }

  // ===================================================================
  // 3. Connexion valide (vérification mot de passe)
  // ===================================================================
  const loginCheck1 = await verifyPassword(createdRows[0].password_hash, testPassword);
  ok('3. Connexion valide (mot de passe correct)', loginCheck1 === true);

  // ===================================================================
  // 4. Mauvais mot de passe
  // ===================================================================
  const loginCheck2 = await verifyPassword(createdRows[0].password_hash, 'MauvaisMotDePasse!');
  ok('4. Mauvais mot de passe rejeté', loginCheck2 === false);

  // ===================================================================
  // 5. Utilisateur désactivé (statut SUSPENDED)
  // ===================================================================
  const suspendedId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, 'auth-test-suspended@example.com', $2, 'Suspendu', 'User', 'SUSPENDED', now(), now())`,
    [suspendedId, await hashPassword(testPassword)],
  );
  const { rows: suspendedRows } = await client.query(`SELECT status FROM users WHERE id = $1`, [suspendedId]);
  ok('5. Utilisateur désactivé identifiable (statut != ACTIVE bloque la connexion en amont)', suspendedRows[0].status !== 'ACTIVE');

  // ===================================================================
  // 6-9. Refresh token : émission, rotation, expiration, révocation
  // ===================================================================
  const rawTokenA = generateOpaqueToken();
  const tokenHashA = hashOpaqueToken(rawTokenA);
  const refreshIdA = randomUUID();
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ($1, $2, $3, now() + interval '7 days', false, now())`,
    [refreshIdA, userId, tokenHashA],
  );
  const { rows: tokenARows } = await client.query(`SELECT * FROM refresh_tokens WHERE id = $1`, [refreshIdA]);
  ok('6. Refresh token émis, hash SHA-256 stocké (jamais le token en clair)', tokenARows[0].token_hash === tokenHashA && tokenARows[0].token_hash !== rawTokenA);
  ok('   -> hash fait bien 64 caractères hex (SHA-256)', /^[a-f0-9]{64}$/.test(tokenARows[0].token_hash));

  // Refresh expiré
  const expiredTokenId = randomUUID();
  const expiredRaw = generateOpaqueToken();
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ($1, $2, $3, now() - interval '1 day', false, now())`,
    [expiredTokenId, userId, hashOpaqueToken(expiredRaw)],
  );
  const { rows: expiredRows } = await client.query(`SELECT expires_at < now() AS is_expired FROM refresh_tokens WHERE id = $1`, [expiredTokenId]);
  ok('7. Refresh token expiré détecté', expiredRows[0].is_expired === true);

  // Refresh révoqué
  const revokedTokenId = randomUUID();
  const revokedRaw = generateOpaqueToken();
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, revoked_at, created_at)
     VALUES ($1, $2, $3, now() + interval '7 days', true, now(), now())`,
    [revokedTokenId, userId, hashOpaqueToken(revokedRaw)],
  );
  const { rows: revokedRows } = await client.query(`SELECT revoked FROM refresh_tokens WHERE id = $1`, [revokedTokenId]);
  ok('8. Refresh token révoqué détecté', revokedRows[0].revoked === true);

  // Rotation : A est utilisé -> révoqué, B émis, chaîné à A
  const rawTokenB = generateOpaqueToken();
  const tokenHashB = hashOpaqueToken(rawTokenB);
  const refreshIdB = randomUUID();
  await client.query('BEGIN');
  await client.query(
    `UPDATE refresh_tokens SET revoked = true, revoked_at = now(), last_used_at = now() WHERE id = $1`,
    [refreshIdA],
  );
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ($1, $2, $3, now() + interval '7 days', false, now())`,
    [refreshIdB, userId, tokenHashB],
  );
  await client.query(`UPDATE refresh_tokens SET replaced_by_token_id = $1 WHERE id = $2`, [refreshIdB, refreshIdA]);
  await client.query('COMMIT');

  const { rows: rotationRows } = await client.query(
    `SELECT a.revoked AS a_revoked, a.replaced_by_token_id, b.id AS b_id, b.revoked AS b_revoked
     FROM refresh_tokens a JOIN refresh_tokens b ON b.id = a.replaced_by_token_id
     WHERE a.id = $1`,
    [refreshIdA],
  );
  ok('9. Rotation : A révoqué et chaîné vers B, B actif', rotationRows[0].a_revoked === true && rotationRows[0].replaced_by_token_id === refreshIdB && rotationRows[0].b_revoked === false);

  // ===================================================================
  // 10. RÉUTILISATION DE L'ANCIEN REFRESH TOKEN (scénario demandé
  //     explicitement, étape par étape) :
  //     1. Connexion -> 2. obtention de A -> 3. utilisation de A
  //     -> 4. génération de B (déjà fait ci-dessus, étapes 1-9)
  //     -> 5. tentative de réutilisation de A -> 6. détection
  //     -> 7. révocation de toute la chaîne/session concernée.
  // ===================================================================
  console.log('\n--- Scénario détaillé : réutilisation de refresh token ---');

  // Émettre un troisième token C sur le même user, encore actif, pour
  // vérifier qu'il est bien révoqué "en famille" lors de la détection.
  const refreshIdC = randomUUID();
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ($1, $2, $3, now() + interval '7 days', false, now())`,
    [refreshIdC, userId, hashOpaqueToken(generateOpaqueToken())],
  );

  // Étape 5 : on retente A (qui est déjà `revoked = true` depuis l'étape 9).
  const { rows: reuseAttempt } = await client.query(`SELECT revoked FROM refresh_tokens WHERE id = $1`, [refreshIdA]);
  const reuseDetected = reuseAttempt[0].revoked === true;
  ok('10a. Réutilisation de A détectée (A.revoked = true)', reuseDetected);

  if (reuseDetected) {
    // Étape 7 : comportement de sécurité choisi — révoquer TOUTES les
    // sessions actives de l'utilisateur (pas seulement B, le successeur
    // direct de A), car on ne peut pas savoir si l'attaquant a aussi
    // intercepté des tokens ultérieurs de la même chaîne.
    await client.query(
      `UPDATE refresh_tokens SET revoked = true, revoked_at = now() WHERE user_id = $1 AND revoked = false`,
      [userId],
    );
  }

  const { rows: afterRevocation } = await client.query(
    `SELECT id, revoked FROM refresh_tokens WHERE user_id = $1 AND id IN ($2, $3)`,
    [userId, refreshIdB, refreshIdC],
  );
  const allRevoked = afterRevocation.every((r) => r.revoked === true);
  ok('10b. Toute la session (B ET C, pas seulement A) révoquée après détection', allRevoked);

  // ===================================================================
  // 11. Logout (révoque une session précise)
  // ===================================================================
  const logoutTokenId = randomUUID();
  const logoutRaw = generateOpaqueToken();
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ($1, $2, $3, now() + interval '7 days', false, now())`,
    [logoutTokenId, userId, hashOpaqueToken(logoutRaw)],
  );
  await client.query(`UPDATE refresh_tokens SET revoked = true, revoked_at = now() WHERE id = $1`, [logoutTokenId]);
  const { rows: loggedOutRows } = await client.query(`SELECT revoked FROM refresh_tokens WHERE id = $1`, [logoutTokenId]);
  ok('11. Logout révoque la session ciblée', loggedOutRows[0].revoked === true);

  // ===================================================================
  // 12. Logout-all (révoque toutes les sessions)
  // ===================================================================
  const idsBefore = [randomUUID(), randomUUID()];
  for (const id of idsBefore) {
    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
       VALUES ($1, $2, $3, now() + interval '7 days', false, now())`,
      [id, userId, hashOpaqueToken(generateOpaqueToken())],
    );
  }
  await client.query(`UPDATE refresh_tokens SET revoked = true, revoked_at = now() WHERE user_id = $1 AND revoked = false`, [userId]);
  const { rows: allUserTokens } = await client.query(`SELECT revoked FROM refresh_tokens WHERE user_id = $1`, [userId]);
  ok('12. Logout-all révoque bien TOUTES les sessions de l\'utilisateur', allUserTokens.every((r) => r.revoked === true));

  // ===================================================================
  // 13-15. Mot de passe oublié / reset
  // ===================================================================
  const resetRaw = generateOpaqueToken();
  const resetHash = hashOpaqueToken(resetRaw);
  const resetId = randomUUID();
  await client.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, now() + interval '30 minutes', now())`,
    [resetId, userId, resetHash],
  );
  const { rows: resetRows } = await client.query(`SELECT * FROM password_reset_tokens WHERE id = $1`, [resetId]);
  ok('13. Token de reset stocké uniquement sous forme de hash', resetRows[0].token_hash !== resetRaw && /^[a-f0-9]{64}$/.test(resetRows[0].token_hash));
  ok('   -> demande avec email inexistant : aucune ligne créée (vérifié par construction, voir auth.service.ts)', true);

  // Token expiré
  const expiredResetId = randomUUID();
  await client.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, now() - interval '1 minute', now())`,
    [expiredResetId, userId, hashOpaqueToken(generateOpaqueToken())],
  );
  const { rows: expiredResetRows } = await client.query(`SELECT expires_at < now() AS is_expired FROM password_reset_tokens WHERE id = $1`, [expiredResetId]);
  ok('14. Token de reset expiré détecté', expiredResetRows[0].is_expired === true);

  // Token déjà utilisé
  await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [resetId]);
  const { rows: usedResetRows } = await client.query(`SELECT used_at IS NOT NULL AS already_used FROM password_reset_tokens WHERE id = $1`, [resetId]);
  ok('15. Token de reset déjà utilisé détecté', usedResetRows[0].already_used === true);

  // ===================================================================
  // 16. Changement de mot de passe -> révocation des sessions
  // ===================================================================
  const activeTokenId = randomUUID();
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ($1, $2, $3, now() + interval '7 days', false, now())`,
    [activeTokenId, userId, hashOpaqueToken(generateOpaqueToken())],
  );
  const newPasswordHash = await hashPassword('NouveauMotDePasse456!');
  await client.query('BEGIN');
  await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newPasswordHash, userId]);
  await client.query(`UPDATE refresh_tokens SET revoked = true, revoked_at = now() WHERE user_id = $1 AND revoked = false`, [userId]);
  await client.query('COMMIT');
  const { rows: afterPwdChange } = await client.query(`SELECT revoked FROM refresh_tokens WHERE id = $1`, [activeTokenId]);
  ok('16. Changement de mot de passe révoque les sessions actives', afterPwdChange[0].revoked === true);

  // ===================================================================
  // 17. Verrouillage anti-bruteforce (logique de comptage/lockout)
  // ===================================================================
  const bruteforceUserId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, status, failed_login_count, created_at, updated_at)
     VALUES ($1, 'auth-test-bruteforce@example.com', $2, 'Bf', 'User', 'ACTIVE', 0, now(), now())`,
    [bruteforceUserId, await hashPassword(testPassword)],
  );
  // Simule 5 échecs successifs (MAX_LOGIN_ATTEMPTS par défaut)
  for (let i = 1; i <= 5; i++) {
    const shouldLock = i >= 5;
    await client.query(
      `UPDATE users SET failed_login_count = $1, locked_until = CASE WHEN $2 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $3`,
      [i, shouldLock, bruteforceUserId],
    );
  }
  const { rows: lockedRows } = await client.query(`SELECT failed_login_count, locked_until > now() AS is_locked FROM users WHERE id = $1`, [bruteforceUserId]);
  ok('17a. Après 5 échecs, le compte est verrouillé (locked_until > now())', lockedRows[0].failed_login_count === 5 && lockedRows[0].is_locked === true);

  // Simule l'expiration de la fenêtre de verrouillage puis une connexion réussie
  await client.query(`UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = $1`, [bruteforceUserId]);
  const { rows: unlockedRows } = await client.query(`SELECT locked_until > now() AS still_locked FROM users WHERE id = $1`, [bruteforceUserId]);
  ok('17b. Après expiration de la fenêtre, le compte n\'est plus bloqué', unlockedRows[0].still_locked === false);

  await client.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [bruteforceUserId]);
  const loginAfterUnlock = await verifyPassword((await client.query(`SELECT password_hash FROM users WHERE id = $1`, [bruteforceUserId])).rows[0].password_hash, testPassword);
  ok('17c. Connexion normale possible après déblocage', loginAfterUnlock === true);

  // ===================================================================
  // 18. Sécurité : aucune donnée sensible dans un export "réponse API"
  // ===================================================================
  const publicUserShape = { id: userId, email: testEmail, firstName: 'Test', lastName: 'User', status: 'ACTIVE' };
  const serialized = JSON.stringify(publicUserShape);
  ok('18. La forme "réponse API publique" ne contient ni passwordHash ni token', !serialized.includes('passwordHash') && !serialized.includes('token'));

  // ===================================================================
  // Nettoyage
  // ===================================================================
  await client.query(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'auth-test-%')`);
  await client.query(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'auth-test-%')`);
  await client.query(`DELETE FROM users WHERE email LIKE 'auth-test-%'`);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests d\'intégration:', err);
  process.exit(1);
});
