/**
 * Seed de développement — DONNÉES 100% FICTIVES.
 *
 * Miroir de prisma/seed/seed.sql (source de vérité testée et utilisée
 * dans ce projet — voir README, section "Seed"), à utiliser via
 * `npx prisma db seed` une fois `prisma generate` fonctionnel (réseau
 * non restreint, voir README "Limites connues"). Corrigé lors de la
 * préparation au déploiement : ce fichier utilisait encore la colonne
 * `account_class`, supprimée par la migration de l'Étape 6, et hachait
 * le mot de passe de démonstration avec bcrypt alors que l'application
 * vérifie exclusivement avec Argon2id (password.util.ts) — le compte
 * de démonstration ne pouvait donc jamais se connecter réellement.
 *
 * Identifiants de démonstration :
 *   email    : admin@demo.local
 *   password : Demo1234!
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// Mêmes paramètres qu'auth/password.util.ts — jamais une seconde
// politique de hachage créée pour le seed.
const ARGON2_OPTIONS: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('Demo1234!', ARGON2_OPTIONS);

  const framework = await prisma.accountingFramework.findUniqueOrThrow({ where: { code: 'SYSCOHADA_REVISED' } });

  const company = await prisma.company.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Entreprise Démo SARL',
      legalName: 'Entreprise Démo SARL',
      registrationNumber: 'RCCM-DEMO-0001',
      taxIdNumber: 'IFU-DEMO-0001',
      country: 'BJ',
      accountingFrameworkId: framework.id,
      currency: 'XOF',
      city: 'Cotonou',
      phone: '+229 00 00 00 00',
      email: 'contact@demo.local',
      fiscalYearStartMonth: 1,
      status: 'ACTIVE',
    },
  });

  const admin = await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'admin@demo.local',
      passwordHash,
      firstName: 'Admin',
      lastName: 'Démo',
      status: 'ACTIVE',
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      companyId: company.id,
      name: 'Administrateur',
      description: "Accès complet à l'entreprise de démonstration",
    },
  });

  await prisma.userCompany.upsert({
    where: { id: '00000000-0000-0000-0000-000000000004' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000004',
      userId: admin.id,
      companyId: company.id,
      roleId: adminRole.id,
      isDefault: true,
    },
  });

  await prisma.accountingPeriod.upsert({
    where: { id: '00000000-0000-0000-0000-000000000005' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000005',
      companyId: company.id,
      name: 'Exercice 2026',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      status: 'OPEN',
    },
  });

  const accountClasses = await prisma.accountClass.findMany({ where: { frameworkId: framework.id } });
  const classIdByCode = new Map(accountClasses.map((c: any) => [c.code, c.id]));

  const accounts: Array<{ code: string; label: string; classCode: string; nature: 'DEBIT' | 'CREDIT' }> = [
    { code: '101000', label: 'Capital social', classCode: '1', nature: 'CREDIT' },
    { code: '411000', label: 'Clients', classCode: '4', nature: 'DEBIT' },
    { code: '401000', label: 'Fournisseurs', classCode: '4', nature: 'CREDIT' },
    { code: '443000', label: 'TVA facturée', classCode: '4', nature: 'CREDIT' },
    { code: '445000', label: 'TVA déductible', classCode: '4', nature: 'DEBIT' },
    { code: '512000', label: 'Banque', classCode: '5', nature: 'DEBIT' },
    { code: '571000', label: 'Caisse', classCode: '5', nature: 'DEBIT' },
    { code: '601000', label: 'Achats de marchandises', classCode: '6', nature: 'DEBIT' },
    { code: '701000', label: 'Ventes de marchandises', classCode: '7', nature: 'CREDIT' },
  ];
  for (const account of accounts) {
    const accountClassId = classIdByCode.get(account.classCode);
    if (!accountClassId) throw new Error(`Classe de compte "${account.classCode}" introuvable pour le référentiel ${framework.code}.`);
    await prisma.account.upsert({
      where: { companyId_code: { companyId: company.id, code: account.code } },
      update: {},
      create: {
        companyId: company.id,
        frameworkId: framework.id,
        accountClassId,
        code: account.code,
        label: account.label,
        nature: account.nature,
        level: 2,
        isPostable: true,
      },
    });
  }

  const journals: Array<{ code: string; label: string; type: 'SALES' | 'PURCHASES' | 'BANK' | 'CASH' | 'GENERAL' }> = [
    { code: 'VE', label: 'Journal des ventes', type: 'SALES' },
    { code: 'AC', label: 'Journal des achats', type: 'PURCHASES' },
    { code: 'BQ', label: 'Journal de banque', type: 'BANK' },
    { code: 'CA', label: 'Journal de caisse', type: 'CASH' },
    { code: 'OD', label: 'Journal des opérations diverses', type: 'GENERAL' },
  ];
  for (const journal of journals) {
    await prisma.journal.upsert({
      where: { companyId_code: { companyId: company.id, code: journal.code } },
      update: {},
      create: { companyId: company.id, ...journal },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed terminé — entreprise de démonstration prête.');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
