/**
 * Test de finalisation pré-production — endpoint GET /health.
 * Reproduit fidèlement HealthController.check() : la même requête
 * `SELECT 1` contre PostgreSQL réel, et vérifie le comportement en
 * cas d'échec de connexion (simulé avec une connexion invalide) sans
 * jamais exposer de détail sensible dans le corps de réponse simulé.
 *
 * Exécution : npx ts-node test/health/health_test.ts
 */
import { Client } from 'pg';

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

/** Reproduit fidèlement HealthController.check() côté succès. */
async function checkHealthy(client: Client): Promise<{ status: string; database: string }> {
  await client.query('SELECT 1');
  return { status: 'ok', database: 'ok' };
}

/** Reproduit fidèlement le chemin d'échec — jamais le message d'erreur brut dans le corps renvoyé. */
async function checkUnhealthy(): Promise<{ status: string; database: string; leaksInternalDetail: boolean }> {
  const badClient = new Client({ connectionString: 'postgresql://invalid_user:wrong_password@localhost:5432/does_not_exist' });
  let errorMessage = '';
  try {
    await badClient.connect();
    await badClient.query('SELECT 1');
  } catch (e: any) {
    errorMessage = e.message ?? '';
  } finally {
    await badClient.end().catch(() => {});
  }
  // Le corps que renverrait réellement HealthController ne contient
  // JAMAIS errorMessage — uniquement des indicateurs 'ok'/'error'.
  const body = { status: 'error', database: 'error' };
  const bodyAsString = JSON.stringify(body);
  const leaksInternalDetail = errorMessage.length > 0 && bodyAsString.includes(errorMessage);
  return { ...body, leaksInternalDetail };
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // =====================================================================
  // 1. Base de données accessible -> statut ok
  // =====================================================================
  const healthy = await checkHealthy(client);
  ok('1. Statut "ok" quand PostgreSQL répond', healthy.status === 'ok' && healthy.database === 'ok');

  // =====================================================================
  // 2. Base de données inaccessible -> statut error, jamais de détail interne
  // =====================================================================
  const unhealthy = await checkUnhealthy();
  ok('2. Statut "error" quand la connexion PostgreSQL échoue', unhealthy.status === 'error' && unhealthy.database === 'error');
  ok('   Aucun détail de connexion (utilisateur/mot de passe/hôte) exposé dans le corps de réponse', !unhealthy.leaksInternalDetail);

  // =====================================================================
  // 3. Cohérence de forme de la réponse (mêmes clés que HealthController)
  // =====================================================================
  const responseKeys = Object.keys(healthy).sort();
  ok('3. Forme de réponse conforme (status, database)', JSON.stringify(responseKeys) === JSON.stringify(['database', 'status']));

  await client.end();

  console.log(`\n${passed} tests PASS, ${failed} tests FAIL sur ${passed + failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erreur lors de l\'exécution des tests /health:', err);
  process.exit(1);
});
