import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

interface CsvRow {
  lineNumber: number;
  code: string;
  label: string;
  parentCode: string | null;
  classCode: string | null;
  allowsPosting: boolean;
}

interface ImportError {
  line: number;
  code: string | null;
  message: string;
}

@Injectable()
export class ChartOfAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // LECTURE
  // =====================================================================

  async listAccounts(companyId: string) {
    return this.prisma.account.findMany({
      where: { companyId },
      include: { accountClass: true },
      orderBy: { code: 'asc' },
    });
  }

  async getAccount(companyId: string, accountId: string) {
    return this.getAccountOrThrow(companyId, accountId);
  }

  async getChildren(companyId: string, accountId: string) {
    await this.getAccountOrThrow(companyId, accountId); // vérifie l'appartenance
    return this.prisma.account.findMany({ where: { companyId, parentId: accountId }, orderBy: { code: 'asc' } });
  }

  /** Arborescence complète, groupée par classe, pour l'affichage hiérarchique. */
  async getTree(companyId: string) {
    const [classes, accounts] = await Promise.all([
      this.prisma.accountClass.findMany({
        where: { accounts: { some: { companyId } } },
        orderBy: { displayOrder: 'asc' },
      }),
      this.prisma.account.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
    ]);

    const byParent = new Map<string, typeof accounts>();
    for (const acc of accounts) {
      const key = acc.parentId ?? `class:${acc.accountClassId}`;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(acc);
    }

    function buildNode(account: (typeof accounts)[number]): any {
      return {
        id: account.id,
        code: account.code,
        label: account.label,
        level: account.level,
        isPostable: account.isPostable,
        isActive: account.isActive,
        children: (byParent.get(account.id) ?? []).map(buildNode),
      };
    }

    return classes.map((cls: any) => ({
      classId: cls.id,
      classCode: cls.code,
      className: cls.name,
      accounts: (byParent.get(`class:${cls.id}`) ?? []).map(buildNode),
    }));
  }

  // =====================================================================
  // ÉCRITURE
  // =====================================================================

  async createAccount(companyId: string, userId: string, dto: CreateAccountDto, meta: RequestMetadata) {
    const accountClass = await this.prisma.accountClass.findUnique({ where: { id: dto.accountClassId } });
    if (!accountClass) throw new BadRequestException('Classe comptable inconnue.');

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (company?.accountingFrameworkId !== accountClass.frameworkId) {
      throw new BadRequestException("Cette classe comptable n'appartient pas au référentiel de l'entreprise.");
    }

    let level = 1;
    if (dto.parentId) {
      const parent = await this.prisma.account.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.companyId !== companyId) {
        throw new BadRequestException('Compte parent introuvable pour cette entreprise.');
      }
      level = parent.level + 1;
    }

    const existing = await this.prisma.account.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Le code "${dto.code}" existe déjà pour cette entreprise.`);

        const account = await this.prisma.account.create({
      data: {
        companyId,
        accountClassId: dto.accountClassId,
        frameworkId: accountClass.frameworkId,
        code: dto.code,
        label: dto.label,
        parentId: dto.parentId,
        level,
        nature: dto.nature ?? 'BOTH',
        isAuxiliary: dto.isAuxiliary ?? false,
        isPostable: dto.isPostable ?? true,
        description: dto.description,
      },
    });

    await this.audit('CREATE', userId, companyId, 'Account', account.id, null, { code: account.code, label: account.label }, meta);
    return account;
  }

  async updateAccount(companyId: string, accountId: string, userId: string, dto: UpdateAccountDto, meta: RequestMetadata) {
    const before = await this.getAccountOrThrow(companyId, accountId);

    const updated = await this.prisma.account.update({
      where: { id: accountId },
      data: {
        label: dto.label,
        isAuxiliary: dto.isAuxiliary,
        isPostable: dto.isPostable,
        description: dto.description,
      },
    });

    await this.audit('UPDATE', userId, companyId, 'Account', accountId, { label: before.label }, { label: updated.label }, meta);
    return updated;
  }

  /**
   * Désactivation uniquement — jamais de suppression physique d'un
   * compte déjà potentiellement référencé (même si aucune écriture
   * n'existe encore à ce stade du projet, la règle est posée dès
   * maintenant pour ne jamais avoir à la retirer plus tard — voir
   * cahier des charges §16 et REVUE-ETAPE-6.md).
   */
  async disableAccount(companyId: string, accountId: string, userId: string, meta: RequestMetadata) {
    await this.getAccountOrThrow(companyId, accountId);

    const updated = await this.prisma.account.update({ where: { id: accountId }, data: { isActive: false } });
    await this.audit('ACCOUNT_DISABLE', userId, companyId, 'Account', accountId, null, null, meta);
    return updated;
  }

  async enableAccount(companyId: string, accountId: string, userId: string, meta: RequestMetadata) {
    await this.getAccountOrThrow(companyId, accountId);

    const updated = await this.prisma.account.update({ where: { id: accountId }, data: { isActive: true } });
    await this.audit('ACCOUNT_ENABLE', userId, companyId, 'Account', accountId, null, null, meta);
    return updated;
  }

  // =====================================================================
  // IMPORT CSV
  // =====================================================================

  /**
   * Format attendu (en-tête obligatoire) :
   *   code;label;parentCode;class;allowsPosting
   * `class` référence le CODE de la classe (ex: "4"), pas son id
   * interne. `parentCode` peut référencer un compte déjà en base OU un
   * autre compte du même fichier (résolution en plusieurs passes).
   *
   * Tout est exécuté dans UNE transaction : la moindre erreur annule
   * l'intégralité de l'import (aucune création partielle).
   */
  async importAccounts(companyId: string, userId: string, csvContent: string, meta: RequestMetadata) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company?.accountingFrameworkId) {
      throw new BadRequestException("L'entreprise n'a pas de référentiel comptable configuré.");
    }

    const { rows, parseErrors } = this.parseCsv(csvContent);
    if (parseErrors.length > 0) {
      throw new BadRequestException({ message: 'Fichier CSV invalide.', errors: parseErrors });
    }

    const errors: ImportError[] = [];
    const codesInFile = new Set<string>();

    // 1. Doublons DANS le fichier
    for (const row of rows) {
      if (codesInFile.has(row.code)) {
        errors.push({ line: row.lineNumber, code: row.code, message: `Code en double dans le fichier : "${row.code}".` });
      }
      codesInFile.add(row.code);
    }

    // 2. Doublons contre la base existante
    const existingAccounts = await this.prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, level: true } });
    const existingByCode = new Map<string, { id: string; code: string; level: number }>(
      existingAccounts.map((a: { id: string; code: string; level: number }) => [a.code, a]),
    );
    for (const row of rows) {
      if (existingByCode.has(row.code)) {
        errors.push({ line: row.lineNumber, code: row.code, message: `Le compte "${row.code}" existe déjà pour cette entreprise.` });
      }
    }

    // 3. Classes référencées
    const classes = await this.prisma.accountClass.findMany({ where: { frameworkId: company.accountingFrameworkId } });
    const classByCode = new Map<string, { id: string; code: string; frameworkId: string }>(
      classes.map((c: { id: string; code: string; frameworkId: string }) => [c.code, c]),
    );
    for (const row of rows) {
      if (!row.classCode || !classByCode.has(row.classCode)) {
        errors.push({ line: row.lineNumber, code: row.code, message: `Classe comptable inconnue pour le référentiel de l'entreprise : "${row.classCode}".` });
      }
    }

    // 4. Comptes parents : doivent exister soit en base, soit dans le fichier
    for (const row of rows) {
      if (!row.parentCode) continue;
      if (row.parentCode === row.code) {
        errors.push({ line: row.lineNumber, code: row.code, message: 'Un compte ne peut pas être son propre parent.' });
        continue;
      }
      const existsInDb = existingByCode.has(row.parentCode);
      const existsInFile = codesInFile.has(row.parentCode);
      if (!existsInDb && !existsInFile) {
        errors.push({ line: row.lineNumber, code: row.code, message: `Compte parent introuvable : "${row.parentCode}".` });
      }
    }

    // 5. Détection de cycles parmi les lignes du fichier (niveaux incohérents)
    const parentOf = new Map(rows.filter((r) => r.parentCode).map((r) => [r.code, r.parentCode as string]));
    for (const row of rows) {
      const seen = new Set<string>([row.code]);
      let current = parentOf.get(row.code);
      let hops = 0;
      while (current && hops < rows.length + 1) {
        if (seen.has(current)) {
          errors.push({ line: row.lineNumber, code: row.code, message: `Chaîne de parenté circulaire détectée impliquant "${row.code}".` });
          break;
        }
        seen.add(current);
        current = parentOf.get(current);
        hops++;
      }
    }

    if (errors.length > 0) {
      // Aucune donnée créée : on s'arrête avant toute écriture en base.
      throw new BadRequestException({ message: `${errors.length} erreur(s) détectée(s) — aucun compte importé.`, errors });
    }

    // 6. Résolution des niveaux par passes successives (un compte dont
    // le parent est dans le fichier ne peut être créé qu'après son
    // parent — tri topologique simple par tentatives répétées).
    const resolvedLevel = new Map<string, number>();
    for (const [code, acc] of existingByCode) resolvedLevel.set(code, acc.level);

    const remaining = [...rows];
    let progress = true;
    const orderedRows: CsvRow[] = [];
    while (remaining.length > 0 && progress) {
      progress = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const row = remaining[i];
        if (!row.parentCode) {
          resolvedLevel.set(row.code, 1);
          orderedRows.push(row);
          remaining.splice(i, 1);
          progress = true;
        } else if (resolvedLevel.has(row.parentCode)) {
          resolvedLevel.set(row.code, resolvedLevel.get(row.parentCode)! + 1);
          orderedRows.push(row);
          remaining.splice(i, 1);
          progress = true;
        }
      }
    }
    // `remaining` non vide ici est déjà exclu par la détection de
    // cycle/parent manquant réalisée plus haut.

    // 7. Création transactionnelle — tout ou rien.
    const created = await this.prisma.$transaction(async (tx: any) => {
      const idByCode = new Map<string, string>();
      for (const [code, acc] of existingByCode) idByCode.set(code, acc.id);

      const createdRows = [];
      for (const row of orderedRows) {
        const parentId = row.parentCode ? idByCode.get(row.parentCode) : undefined;
        const accountClass = classByCode.get(row.classCode!)!;
        const acc = await tx.account.create({
          data: {
            companyId,
            accountClassId: accountClass.id,
            code: row.code,
            label: row.label,
            parentId,
            level: resolvedLevel.get(row.code)!,
            isPostable: row.allowsPosting,
          },
        });
        idByCode.set(row.code, acc.id);
        createdRows.push(acc);
      }
      return createdRows;
    });

    await this.audit('ACCOUNT_IMPORT', userId, companyId, 'Account', null, null, { importedCount: created.length }, meta);

    return { importedCount: created.length, accounts: created };
  }

  /** Parseur CSV minimal (délimiteur ';', gère les guillemets simples). */
  private parseCsv(content: string): { rows: CsvRow[]; parseErrors: ImportError[] } {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const parseErrors: ImportError[] = [];
    if (lines.length === 0) {
      return { rows: [], parseErrors: [{ line: 0, code: null, message: 'Fichier vide.' }] };
    }

    const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
    const expected = ['code', 'label', 'parentcode', 'class', 'allowsposting'];
    const missing = expected.filter((col) => !header.includes(col));
    if (missing.length > 0) {
      return { rows: [], parseErrors: [{ line: 1, code: null, message: `Colonnes manquantes dans l'en-tête : ${missing.join(', ')}.` }] };
    }

    const idx = {
      code: header.indexOf('code'),
      label: header.indexOf('label'),
      parentCode: header.indexOf('parentcode'),
      classCode: header.indexOf('class'),
      allowsPosting: header.indexOf('allowsposting'),
    };

    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
      const code = cols[idx.code];
      const label = cols[idx.label];

      if (!code) {
        parseErrors.push({ line: i + 1, code: null, message: 'Code de compte manquant.' });
        continue;
      }
      if (!label) {
        parseErrors.push({ line: i + 1, code, message: 'Libellé manquant.' });
        continue;
      }

      rows.push({
        lineNumber: i + 1,
        code,
        label,
        parentCode: cols[idx.parentCode] || null,
        classCode: cols[idx.classCode] || null,
        allowsPosting: (cols[idx.allowsPosting] || 'true').toLowerCase() !== 'false',
      });
    }

    return { rows, parseErrors };
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private async getAccountOrThrow(companyId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, include: { accountClass: true } });
    if (!account || account.companyId !== companyId) {
      throw new NotFoundException('Compte introuvable pour cette entreprise.');
    }
    return account;
  }

  private async audit(
    action: string,
    userId: string,
    companyId: string,
    entityType: string,
    entityId: string | null,
    oldValue: unknown,
    newValue: unknown,
    meta: RequestMetadata,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          companyId,
          action: action as any,
          entityType,
          entityId,
          oldValue: oldValue as any,
          newValue: newValue as any,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });
    } catch {
      // L'audit ne doit jamais faire échouer l'action métier elle-même.
    }
  }
}
