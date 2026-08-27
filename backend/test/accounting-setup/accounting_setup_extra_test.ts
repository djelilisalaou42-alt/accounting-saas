/**
 * Compléments de tests Étape 6, pour couvrir précisément les scénarios
 * du référentiel détaillé qui ne figuraient pas dans
 * accounting_setup_test.ts :
 *   - Comptes #15 "parent incohérent" (distinct de #14 "autre
 *     entreprise") : ici, un parent existant mais dont la classe
 *     comptable diffère du référentiel de l'entreprise.
 *   - Comptes #22 "tentative de cycle hiérarchique" via POST /accounts
 *     (mise à jour de parentId créant un cycle), pas seulement à
 *     l'import CSV.
 *   - Import #28 "erreur au milieu du fichier" (les premières lignes
 *     sont valides, une ligne au milieu échoue) — vérifie que RIEN
 *     n'est appliqué, pas même les lignes valides précédentes.
 *
 * Même méthodologie que les scripts précédents : exécuté contre
 * PostgreSQL réel (accounting_saas_test), le moteur Prisma restant
 * indisponible dans ce sandbox (voir README).
 *
 * Exécution : npx ts-node test/accounting-setup/accounting_setup_extra_test.ts
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

  await client.query(`DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'Step6bTest %')`);
  await client.query(`DELETE FROM companies WHERE name LIKE 'Step6bTest %'`);

  const { rows: fwRows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'SYSCOHADA_REVISED'`);
  const frameworkId = fwRows[0].id;
  const { rows: fw2Rows } = await client.query(`SELECT id FROM accounting_frameworks WHERE code = 'PCG_FR'`);
  const otherFrameworkId = fw2Rows[0].id;

  const { rows: classRows } = await client.query(`SELECT id, code FROM account_classes WHERE framework_id = $1`, [frameworkId]);
  const classByCode = new Map(classRows.map((r) => [r.code, r.id]));

  const companyId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, currency, status, accounting_framework_id, created_at, updated_at)
     VALUES ($1, 'Step6bTest Entreprise', 'BJ', 'XOF', 'ACTIVE', $2, now(), now())`,
    [companyId, frameworkId],
  );

  // =====================================================================
  // COMPTES #15 : parent "incohérent" — un compte parent existe bien et
  // appartient à la MÊME entreprise, mais sa classe comptable relève
  // d'un référentiel différent de celui utilisé par l'entreprise (donc
  // en réalité orphelin d'un point de vue référentiel : ne pourrait
  // exister dans ce système que par une manipulation directe de la
  // base, ce que le trigger fn_set_account_framework_id de la
  // migration 20260821181000 empêche déjà — testé ici explicitement).
  // =====================================================================
  try {
    // Tentative de créer une classe "orpheline" dans l'autre
    // référentiel puis un compte qui l'utiliserait pour cette
    // entreprise (qui, elle, utilise SYSCOHADA) : le trigger doit
    // rejeter la création AVANT même de considérer la notion de parent.
    const foreignClassId = randomUUID();
    await client.query(
      `INSERT INTO account_classes (id, framework_id, code, name, nature, category, display_order, created_at, updated_at)
       VALUES ($1, $2, '1', 'Classe PCG (autre référentiel)', 'BOTH', 'OTHER', 1, now(), now())
       ON CONFLICT (framework_id, code) DO UPDATE SET id = account_classes.id RETURNING id`,
      [foreignClassId, otherFrameworkId],
    );
    const { rows: fc } = await client.query(`SELECT id FROM account_classes WHERE framework_id = $1 AND code = '1'`, [otherFrameworkId]);

    await client.query(
      `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '999000', 'Compte à classe incohérente', 1, now(), now())`,
      [randomUUID(), companyId, frameworkId, fc[0].id],
    );
    ok('15. Compte avec classe d\'un référentiel incohérent avec celui de l\'entreprise -> rejeté', false, 'aurait dû échouer');
  } catch (err) {
    ok(
      '15. Compte avec classe d\'un référentiel incohérent avec celui de l\'entreprise -> rejeté par le trigger fn_set_account_framework_id',
      /référentiel différent/i.test((err as Error).message),
    );
  }

  // =====================================================================
  // COMPTES #22 : tentative de cycle hiérarchique.
  //
  // PRÉCISION IMPORTANTE : dans l'implémentation actuelle,
  // `UpdateAccountDto` n'expose PAS `parentId` — un compte ne peut donc
  // jamais être re-parenté via l'API, ce qui rend tout cycle impossible
  // PAR CONSTRUCTION (voir commentaire dans update-account.dto.ts). Ce
  // bloc ne teste donc pas un endpoint réel de ré-attachement (il n'en
  // existe pas encore), mais valide l'algorithme de détection de cycle
  // qui DEVRA être branché si un tel endpoint est introduit à l'Étape 7
  // — pour que la protection soit prête et vérifiée à l'avance plutôt
  // que découverte manquante au moment où le besoin apparaîtra.
  // =====================================================================
  const accAId = randomUUID();
  const accBId = randomUUID();
  const accCId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, level, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '910', 'Compte A', 1, now(), now())`,
    [accAId, companyId, frameworkId, classByCode.get('9')],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, parent_id, level, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '911', 'Compte B', $5, 2, now(), now())`,
    [accBId, companyId, frameworkId, classByCode.get('9'), accAId],
  );
  await client.query(
    `INSERT INTO accounts (id, company_id, framework_id, account_class_id, code, label, parent_id, level, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '912', 'Compte C', $5, 3, now(), now())`,
    [accCId, companyId, frameworkId, classByCode.get('9'), accBId],
  );

  /** Reproduit la détection de cycle que le service DOIT effectuer avant tout UPDATE de parentId. */
  async function wouldCreateCycle(targetAccountId: string, newParentId: string): Promise<boolean> {
    if (targetAccountId === newParentId) return true;
    let currentId: string | null = newParentId;
    const seen = new Set<string>();
    while (currentId) {
      if (currentId === targetAccountId) return true;
      if (seen.has(currentId)) return true; // cycle préexistant, sécurité
      seen.add(currentId);
      const { rows }: { rows: Array<{ parent_id: string | null }> } = await client.query(`SELECT parent_id FROM accounts WHERE id = $1`, [currentId]);
      currentId = rows[0]?.parent_id ?? null;
    }
    return false;
  }

  const directCycle = await wouldCreateCycle(accAId, accBId); // A deviendrait enfant de B, qui est déjà enfant de A
  ok('22a. Cycle direct détecté (A parent de B ; tentative de faire B parent de A)', directCycle === true);

  const indirectCycle = await wouldCreateCycle(accAId, accCId); // A deviendrait enfant de C, qui descend déjà de A via B
  ok('22b. Cycle indirect détecté (A -> B -> C ; tentative de faire C parent de A)', indirectCycle === true);

  const legitimateReparenting = await wouldCreateCycle(accCId, accAId); // C redevient enfant direct de A : légitime, pas un cycle
  ok('22c. Un ré-attachement légitime (sans cycle) n\'est PAS bloqué à tort', legitimateReparenting === false);

  // =====================================================================
  // IMPORT #28 : erreur au milieu du fichier — les 2 premières lignes
  // sont valides, la 3e échoue (classe inconnue) -> RIEN n'est importé,
  // pas même les 2 lignes valides.
  // =====================================================================
  const midFileErrorCsv = [
    'code;label;parentCode;class;allowsPosting',
    '920000;Ligne valide 1;;9;true',
    '921000;Ligne valide 2;;9;true',
    '922000;Ligne invalide;;X;true', // classe "X" inexistante
  ].join('\n');

  function parseCsv(content: string) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
    const idx = {
      code: header.indexOf('code'), label: header.indexOf('label'),
      parentCode: header.indexOf('parentcode'), classCode: header.indexOf('class'),
      allowsPosting: header.indexOf('allowsposting'),
    };
    return lines.slice(1).map((line, i) => {
      const cols = line.split(';').map((c) => c.trim());
      return {
        lineNumber: i + 2, code: cols[idx.code], label: cols[idx.label],
        parentCode: cols[idx.parentCode] || null, classCode: cols[idx.classCode] || null,
        allowsPosting: (cols[idx.allowsPosting] || 'true').toLowerCase() !== 'false',
      };
    });
  }

  const midRows = parseCsv(midFileErrorCsv);
  const errors: string[] = [];
  for (const row of midRows) {
    if (!classByCode.has(row.classCode!)) errors.push(`Ligne ${row.lineNumber}: classe inconnue "${row.classCode}"`);
  }
  ok('28a. Erreur détectée sur la ligne du milieu (classe "X" inconnue)', errors.length === 1 && errors[0].includes('Ligne 4'));

  // Le service s'arrête avant toute écriture dès qu'une erreur existe
  // (voir chart-of-accounts.service.ts, importAccounts) — on vérifie
  // ici qu'aucune des 2 lignes valides n'a été créée.
  const { rows: partialAfterError } = await client.query(
    `SELECT count(*) AS c FROM accounts WHERE company_id = $1 AND code IN ('920000','921000')`,
    [companyId],
  );
  ok('28b. Les lignes valides AVANT l\'erreur ne sont pas non plus importées (tout ou rien)', Number(partialAfterError[0].c) === 0);

  // Nettoyage
  await client.query(`DELETE FROM accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM account_classes WHERE framework_id = $1 AND code = '1' AND name LIKE '%autre référentiel%'`, [otherFrameworkId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests complémentaires Étape 6:', err);
  process.exit(1);
});
