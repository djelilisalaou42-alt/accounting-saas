/**
 * Tests de préparation au déploiement — vérifie que le seed de
 * démonstration produit réellement un compte utilisable, avec le vrai
 * algorithme de hachage de l'application (Argon2id). Ce scénario avait
 * échoué silencieusement jusqu'à cette vérification : `seed.sql`
 * stockait un hash bcrypt, jamais reconnu par `argon2.verify()` — le
 * login de démonstration documenté depuis le début du projet ne
 * fonctionnait jamais réellement. Aucune suite existante ne le
 * couvrait (chaque test crée ses propres utilisateurs avec un hash
 * frais), d'où l'ajout de ce test dédié.
 *
 * Exécution : npx ts-node test/deployment/deployment_test.ts
 */
import { Client } from 'pg';
import * as argon2 from 'argon2';

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

  // =====================================================================
  // 1. Le compte de démonstration existe et son mot de passe est
  //    réellement vérifiable avec l'algorithme de l'application
  //    (Argon2id) — pas juste présent en base.
  // =====================================================================
  const { rows } = await client.query(`SELECT password_hash, status FROM users WHERE email = 'admin@demo.local'`);
  ok('1. Le compte de démonstration admin@demo.local existe', rows.length === 1);

  if (rows.length === 1) {
    ok('   Le compte de démonstration est ACTIVE', rows[0].status === 'ACTIVE');
    ok('   Le hash stocké est au format Argon2id (jamais bcrypt)', rows[0].password_hash.startsWith('$argon2id$'));

    const passwordValid = await argon2.verify(rows[0].password_hash, 'Demo1234!').catch(() => false);
    ok('2. Le mot de passe de démonstration "Demo1234!" est réellement vérifiable (argon2.verify), reproduisant AuthService.login()', passwordValid === true);

    const wrongPasswordRejected = !(await argon2.verify(rows[0].password_hash, 'MauvaisMotDePasse').catch(() => false));
    ok('   Un mauvais mot de passe est bien rejeté', wrongPasswordRejected);
  }

  // =====================================================================
  // 3. Le plan comptable de démonstration est bien rattaché au
  //    référentiel réel (pas de colonne account_class fantôme).
  // =====================================================================
  const { rows: accountRows } = await client.query(
    `SELECT a.code, a.framework_id, a.account_class_id FROM accounts a
     JOIN companies c ON c.id = a.company_id WHERE c.name = 'Entreprise Démo SARL'`,
  );
  ok('3. Les comptes de démonstration ont framework_id et account_class_id renseignés (jamais NULL)', accountRows.length > 0 && accountRows.every((r: any) => r.framework_id && r.account_class_id));

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests de déploiement:', err);
  process.exit(1);
});
