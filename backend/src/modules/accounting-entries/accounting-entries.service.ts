import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountingEntryDto } from './dto/create-accounting-entry.dto';
import { UpdateAccountingEntryDto } from './dto/update-accounting-entry.dto';
import { ListAccountingEntriesDto } from './dto/list-accounting-entries.dto';
import { ReverseAccountingEntryDto } from './dto/reverse-accounting-entry.dto';
import { CreateAccountingEntryLineDto } from './dto/create-accounting-entry-line.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/** Code d'erreur PostgreSQL renvoyé par les triggers de l'Étape 3 (RAISE EXCEPTION). */
const PG_RAISE_EXCEPTION = 'P0001';

@Injectable()
export class AccountingEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // LECTURE
  // =====================================================================

  async list(companyId: string, filters: ListAccountingEntriesDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;

    const where: any = { companyId };
    if (filters.periodId) where.periodId = filters.periodId;
    if (filters.journalId) where.journalId = filters.journalId;
    if (filters.status) where.status = filters.status;
    if (filters.accountId) where.lines = { some: { accountId: filters.accountId } };
    if (filters.search) {
      where.OR = [
        { entryNumber: { contains: filters.search, mode: 'insensitive' } },
        { label: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [total, entries] = await Promise.all([
      this.prisma.accountingEntry.count({ where }),
      this.prisma.accountingEntry.findMany({
        where,
        include: {
          journal: { select: { code: true, label: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          validatedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, page, pageSize, entries };
  }

  async get(companyId: string, entryId: string) {
    return this.getEntryOrThrow(companyId, entryId, {
      lines: { include: { account: { select: { code: true, label: true } } }, orderBy: { lineNumber: 'asc' } },
      journal: true,
      period: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      validatedBy: { select: { id: true, firstName: true, lastName: true } },
      attachments: true,
      reversalOfEntry: { select: { id: true, entryNumber: true } },
      reversedByEntry: { select: { id: true, entryNumber: true } },
    });
  }

  // =====================================================================
  // CRÉATION (DRAFT)
  // =====================================================================

  async create(companyId: string, userId: string, dto: CreateAccountingEntryDto, meta: RequestMetadata) {
    const entryDate = new Date(dto.entryDate);

    const journal = await this.prisma.journal.findUnique({ where: { id: dto.journalId } });
    if (!journal || journal.companyId !== companyId) {
      throw new BadRequestException('Journal introuvable pour cette entreprise.');
    }
    if (!journal.isActive) {
      throw new BadRequestException('Ce journal est désactivé.');
    }

    // L'exercice n'est JAMAIS pris tel quel depuis le client : il est
    // systématiquement redéterminé côté serveur à partir de la date de
    // l'écriture (cohérence date <-> exercice imposée ici, pas
    // seulement suggérée par le frontend).
    const period = await this.findOpenPeriodForDate(companyId, entryDate);

    await this.validateLinesAccounts(companyId, dto.lines);
    const normalizedLines = this.normalizeLines(dto.lines);

    const entry = await this.prisma.$transaction(async (tx: any) => {
      const entryNumber = await this.generateEntryNumber(tx, companyId, journal.code);

      const created = await tx.accountingEntry.create({
        data: {
          companyId,
          periodId: period.id,
          journalId: journal.id,
          entryNumber,
          entryDate,
          label: dto.label,
          reference: dto.reference,
          status: 'DRAFT',
          createdById: userId,
          totalDebit: normalizedLines.totalDebit,
          totalCredit: normalizedLines.totalCredit,
          lines: {
            create: normalizedLines.lines.map((line, index) => ({
              accountId: line.accountId,
              companyId,
              lineNumber: index + 1,
              side: line.side,
              amount: line.amount,
              label: line.label,
            })),
          },
        },
        include: { lines: true },
      });

      return created;
    });

    await this.audit('CREATE', userId, companyId, 'AccountingEntry', entry.id, null, { entryNumber: entry.entryNumber }, meta);
    return entry;
  }

  // =====================================================================
  // MODIFICATION (DRAFT uniquement)
  // =====================================================================

  async update(companyId: string, entryId: string, userId: string, dto: UpdateAccountingEntryDto, meta: RequestMetadata) {
    const existing = await this.getEntryOrThrow(companyId, entryId);
    if (existing.status !== 'DRAFT') {
      // Filet applicatif — le trigger PostgreSQL trg_b_protect_validated_entries
      // (Étape 3) est la garantie ultime et bloquerait de toute façon
      // l'UPDATE au niveau base si ce contrôle était contourné.
      throw new ForbiddenException('Seule une écriture en brouillon peut être modifiée.');
    }

    let journalId = existing.journalId;
    let entryDate = existing.entryDate;
    let periodId = existing.periodId;

    if (dto.journalId && dto.journalId !== existing.journalId) {
      const journal = await this.prisma.journal.findUnique({ where: { id: dto.journalId } });
      if (!journal || journal.companyId !== companyId) throw new BadRequestException('Journal introuvable pour cette entreprise.');
      if (!journal.isActive) throw new BadRequestException('Ce journal est désactivé.');
      journalId = journal.id;
    }

    if (dto.entryDate) {
      entryDate = new Date(dto.entryDate);
      const period = await this.findOpenPeriodForDate(companyId, entryDate);
      periodId = period.id;
    }

    let normalizedLines: ReturnType<typeof this.normalizeLines> | null = null;
    if (dto.lines) {
      await this.validateLinesAccounts(companyId, dto.lines);
      normalizedLines = this.normalizeLines(dto.lines);
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      if (normalizedLines) {
        await tx.accountingEntryLine.deleteMany({ where: { entryId } });
      }

      return tx.accountingEntry.update({
        where: { id: entryId },
        data: {
          journalId,
          periodId,
          entryDate,
          label: dto.label ?? undefined,
          reference: dto.reference ?? undefined,
          totalDebit: normalizedLines?.totalDebit,
          totalCredit: normalizedLines?.totalCredit,
          lines: normalizedLines
            ? {
                create: normalizedLines.lines.map((line, index) => ({
                  accountId: line.accountId,
                  companyId,
                  lineNumber: index + 1,
                  side: line.side,
                  amount: line.amount,
                  label: line.label,
                })),
              }
            : undefined,
        },
        include: { lines: true },
      });
    });

    await this.audit('UPDATE', userId, companyId, 'AccountingEntry', entryId, null, { label: updated.label }, meta);
    return updated;
  }

  // =====================================================================
  // SUPPRESSION (DRAFT uniquement)
  // =====================================================================

  async remove(companyId: string, entryId: string, userId: string, meta: RequestMetadata) {
    const existing = await this.getEntryOrThrow(companyId, entryId);
    if (existing.status !== 'DRAFT') {
      throw new ForbiddenException('Seule une écriture en brouillon peut être supprimée. Utilisez la contrepassation pour une écriture validée.');
    }

    await this.prisma.accountingEntry.delete({ where: { id: entryId } });
    await this.audit('DELETE', userId, companyId, 'AccountingEntry', entryId, { entryNumber: existing.entryNumber }, null, meta);
  }

  // =====================================================================
  // VALIDATION
  // =====================================================================

  async validate(companyId: string, entryId: string, userId: string, meta: RequestMetadata) {
    const entry = await this.prisma.accountingEntry.findUnique({
      where: { id: entryId },
      include: { lines: true, journal: true, period: true },
    });
    if (!entry || entry.companyId !== companyId) {
      throw new NotFoundException('Écriture comptable introuvable pour cette entreprise.');
    }

    if (entry.status !== 'DRAFT') {
      throw new ConflictException(`Cette écriture est déjà ${entry.status === 'VALIDATED' ? 'validée' : 'contrepassée'}.`);
    }
    if (entry.period.status !== 'OPEN') {
      throw new ForbiddenException("L'exercice comptable de cette écriture n'est plus ouvert.");
    }
    if (!entry.journal.isActive) {
      throw new ForbiddenException('Ce journal est désactivé.');
    }
    if (entry.lines.length < 2) {
      throw new BadRequestException('Une écriture validée doit comporter au moins deux lignes.');
    }

    // Revérification complète des comptes (actif + postable) au moment
    // de la validation — un compte a pu être désactivé depuis la
    // création du brouillon.
    const accountIds = [...new Set(entry.lines.map((l: any) => l.accountId))];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: accountIds } } });
    for (const account of accounts) {
      if (!account.isActive) throw new ForbiddenException(`Le compte ${account.code} est désactivé.`);
      if (!account.isPostable) throw new ForbiddenException(`Le compte ${account.code} est un compte de regroupement (non mouvementable).`);
    }

    // Recalcul des totaux DEPUIS LES LIGNES EN BASE — jamais depuis un
    // total envoyé par le client, jamais depuis le cache
    // total_debit/total_credit de l'écriture elle-même.
    const totalDebit = entry.lines.filter((l: any) => l.side === 'DEBIT').reduce((sum: number, l: any) => sum + Number(l.amount), 0);
    const totalCredit = entry.lines.filter((l: any) => l.side === 'CREDIT').reduce((sum: number, l: any) => sum + Number(l.amount), 0);
    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
      throw new BadRequestException(`Écriture déséquilibrée : débit ${totalDebit} ≠ crédit ${totalCredit}.`);
    }

    let updated;
    try {
      // Le trigger trg_a_check_entry_balance (Étape 3) refait CE MÊME
      // contrôle indépendamment, directement en base, et rejette la
      // transaction si jamais les deux calculs divergeaient — dernière
      // barrière, jamais contournée.
      updated = await this.prisma.accountingEntry.update({
        where: { id: entryId },
        data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() },
      });
    } catch (err: any) {
      if (err?.code === PG_RAISE_EXCEPTION || /déséquilibrée|équilibre/i.test(err?.message ?? '')) {
        throw new BadRequestException('Écriture déséquilibrée (rejetée par la contrainte de base de données).');
      }
      throw err;
    }

    await this.audit('VALIDATE', userId, companyId, 'AccountingEntry', entryId, { status: 'DRAFT' }, { status: 'VALIDATED' }, meta);
    return updated;
  }

  // =====================================================================
  // CONTREPASSATION
  // =====================================================================

  async reverse(companyId: string, entryId: string, userId: string, dto: ReverseAccountingEntryDto, meta: RequestMetadata) {
    const reversalDate = dto.reversalDate ? new Date(dto.reversalDate) : new Date();
    // Déterminé et vérifié AVANT la transaction : la contrepassation
    // doit elle-même tomber dans un exercice ouvert — jamais supposée
    // héritée de la date de l'écriture d'origine.
    const reversalPeriod = await this.findOpenPeriodForDate(companyId, reversalDate);

    const reversal = await this.prisma.$transaction(async (tx: any) => {
      // Verrouille la ligne pour empêcher toute double contrepassation
      // concurrente (deux requêtes simultanées sur la même écriture).
      const rows: any[] = await tx.$queryRaw`
        SELECT * FROM accounting_entries WHERE id = ${entryId} AND company_id = ${companyId} FOR UPDATE
      `;
      const original = rows[0];
      if (!original) throw new NotFoundException('Écriture introuvable pour cette entreprise.');
      if (original.status !== 'VALIDATED') {
        throw new ConflictException("Seule une écriture validée peut être contrepassée.");
      }
      if (original.reversed_by_entry_id) {
        throw new ConflictException('Cette écriture a déjà été contrepassée.');
      }

      const originalLines = await tx.accountingEntryLine.findMany({ where: { entryId }, orderBy: { lineNumber: 'asc' } });

      const journal = await tx.journal.findUnique({ where: { id: original.journal_id } });
      const entryNumber = await this.generateEntryNumber(tx, companyId, journal.code);

      const reversalEntry = await tx.accountingEntry.create({
        data: {
          companyId,
          periodId: reversalPeriod.id,
          journalId: original.journal_id,
          entryNumber,
          entryDate: reversalDate,
          label: `Contrepassation de ${original.entry_number} — ${original.label}`,
          reference: original.reference,
          // Créée d'abord en DRAFT AVEC ses lignes, puis validée dans un
          // second appel juste en dessous : le trigger PostgreSQL
          // fn_check_entry_balance (Étape 3) compte les lignes déjà
          // présentes au moment de la transition vers VALIDATED — si
          // on tentait de créer directement `status: 'VALIDATED'` avec
          // des lignes imbriquées dans le même appel Prisma, la ligne
          // `accounting_entries` serait insérée AVANT ses lignes
          // enfants, et le trigger verrait 0 ligne au moment du
          // contrôle. Bug réel détecté et corrigé via les tests
          // d'intégration (voir test/accounting-entries/).
          status: 'DRAFT',
          createdById: userId,
          reversalOfEntryId: entryId,
          totalDebit: original.total_credit,
          totalCredit: original.total_debit,
          lines: {
            create: originalLines.map((line: any, index: number) => ({
              accountId: line.accountId,
              companyId,
              lineNumber: index + 1,
              // Inversion stricte du sens de chaque ligne — même montant.
              side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
              amount: line.amount,
              label: line.label,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.accountingEntry.update({
        where: { id: reversalEntry.id },
        data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() },
      });

      await tx.accountingEntry.update({ where: { id: entryId }, data: { status: 'REVERSED' } });

      return reversalEntry;
    });

    await this.audit('REVERSE', userId, companyId, 'AccountingEntry', entryId, { status: 'VALIDATED' }, { status: 'REVERSED', reversalEntryId: reversal.id }, meta);
    await this.audit('CREATE', userId, companyId, 'AccountingEntry', reversal.id, null, { entryNumber: reversal.entryNumber, reversalOf: entryId }, meta);

    return reversal;
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  /**
   * Redétermine TOUJOURS l'exercice depuis la date fournie — jamais
   * depuis un `periodId` envoyé par le client (voir §14 du cahier des
   * charges Étape 7).
   */
  private async findOpenPeriodForDate(companyId: string, date: Date) {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    });
    if (!period) {
      throw new BadRequestException(`Aucun exercice comptable ne couvre la date ${date.toISOString().slice(0, 10)}.`);
    }
    if (period.status !== 'OPEN') {
      throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert (statut : ${period.status}).`);
    }
    return period;
  }

  /** Valide chaque ligne : compte existant, de l'entreprise, actif, postable, un seul sens renseigné. */
  private async validateLinesAccounts(companyId: string, lines: CreateAccountingEntryLineDto[]): Promise<void> {
    for (const line of lines) {
      if (line.debit > 0 && line.credit > 0) {
        throw new BadRequestException('Une ligne ne peut pas avoir à la fois un débit et un crédit.');
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new BadRequestException('Chaque ligne doit avoir un débit ou un crédit strictement positif.');
      }
      if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit)) {
        throw new BadRequestException('Montant invalide.');
      }
    }

    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: accountIds } } });
    const byId = new Map<string, { id: string; companyId: string; isActive: boolean; isPostable: boolean; code: string }>(
      accounts.map((a: { id: string; companyId: string; isActive: boolean; isPostable: boolean; code: string }) => [a.id, a]),
    );

    for (const line of lines) {
      const account = byId.get(line.accountId);
      if (!account || account.companyId !== companyId) {
        throw new BadRequestException(`Compte introuvable pour cette entreprise : ${line.accountId}.`);
      }
      if (!account.isActive) {
        throw new BadRequestException(`Le compte ${account.code} est désactivé.`);
      }
      if (!account.isPostable) {
        throw new BadRequestException(`Le compte ${account.code} est un compte de regroupement — il n'accepte pas d'écritures.`);
      }
    }
  }

  private normalizeLines(lines: CreateAccountingEntryLineDto[]) {
    let totalDebit = 0;
    let totalCredit = 0;
    const normalized = lines.map((line) => {
      const side: 'DEBIT' | 'CREDIT' = line.debit > 0 ? 'DEBIT' : 'CREDIT';
      const amount = line.debit > 0 ? line.debit : line.credit;
      if (side === 'DEBIT') totalDebit += amount;
      else totalCredit += amount;
      return { accountId: line.accountId, label: line.label, side, amount };
    });
    return { lines: normalized, totalDebit, totalCredit };
  }

  /**
   * Réutilise fn_next_document_number (Étape 3) — verrou de ligne
   * PostgreSQL, jamais de `SELECT MAX(number) + 1`. Portée par code de
   * journal (chaque journal a sa propre séquence, ex: VEN-000001,
   * ACH-000001) — le numéro final préfixe le code du journal.
   */
  private async generateEntryNumber(tx: any, companyId: string, journalCode: string): Promise<string> {
    const rows: Array<{ number: string }> = await tx.$queryRaw`
      SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journalCode}) as number
    `;
    return `${journalCode}-${rows[0].number}`;
  }

  private async getEntryOrThrow(companyId: string, entryId: string, include?: any) {
    const entry = await this.prisma.accountingEntry.findUnique({ where: { id: entryId }, include });
    if (!entry || entry.companyId !== companyId) {
      throw new NotFoundException('Écriture comptable introuvable pour cette entreprise.');
    }
    return entry;
  }

  private async audit(
    action: string,
    userId: string,
    companyId: string,
    entityType: string,
    entityId: string,
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
