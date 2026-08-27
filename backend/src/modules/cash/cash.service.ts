import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCashAccountDto, UpdateCashAccountDto } from './dto/cash-account.dto';
import { CreateCashMovementDto, CreateCashTransferDto } from './dto/cash-movement.dto';
import { ListCashMovementsDto } from './dto/list-cash.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * =====================================================================
 * CONVENTION DE SOLDE (Étape 11, Phase 3) — documentée ici :
 *
 * `CashAccount.currentBalance` existe dans le modèle depuis les étapes
 * initiales mais N'EST JAMAIS la source de vérité — le cahier des
 * charges interdit explicitement un solde stocké modifiable
 * manuellement. Le solde réel est TOUJOURS recalculé depuis les
 * lignes d'écriture validées du compte comptable associé, avec la
 * MÊME convention que le Grand Livre (Étape 8) : solde = débit −
 * crédit. `currentBalance` reste en base pour compatibilité du schéma
 * existant mais n'est lu par aucun endpoint de ce service.
 *
 * MOUVEMENTS — même pattern DRAFT→lignes→VALIDATED que les Étapes 7/10
 * (jamais de création directe VALIDATED avec lignes imbriquées).
 * =====================================================================
 */
@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // CAISSES
  // =====================================================================

  async list(companyId: string) {
    return this.prisma.cashAccount.findMany({
      where: { companyId },
      include: { account: { select: { code: true, label: true } } },
      orderBy: { code: 'asc' },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOrThrow(companyId, id, { account: { select: { code: true, label: true } } });
  }

  async create(companyId: string, userId: string, dto: CreateCashAccountDto, meta: RequestMetadata) {
    await this.validateTreasuryAccount(companyId, dto.accountId);
    const existing = await this.prisma.cashAccount.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Le code de caisse "${dto.code}" existe déjà pour cette entreprise.`);

    const cash = await this.prisma.cashAccount.create({
      data: { companyId, code: dto.code, name: dto.name, accountId: dto.accountId, currency: dto.currency ?? 'XOF', description: dto.description },
    });
    await this.audit('CREATE', userId, companyId, 'CashAccount', cash.id, null, { code: cash.code }, meta);
    return cash;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateCashAccountDto, meta: RequestMetadata) {
    const before = await this.getOrThrow(companyId, id);
    const updated = await this.prisma.cashAccount.update({ where: { id }, data: { name: dto.name, description: dto.description } });
    await this.audit('UPDATE', userId, companyId, 'CashAccount', id, { name: before.name }, { name: updated.name }, meta);
    return updated;
  }

  async disable(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, id);
    const updated = await this.prisma.cashAccount.update({ where: { id }, data: { isActive: false } });
    await this.audit('UPDATE', userId, companyId, 'CashAccount', id, null, { isActive: false }, meta);
    return updated;
  }

  async enable(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, id);
    const updated = await this.prisma.cashAccount.update({ where: { id }, data: { isActive: true } });
    await this.audit('UPDATE', userId, companyId, 'CashAccount', id, null, { isActive: true }, meta);
    return updated;
  }

  /** Solde recalculé depuis les lignes validées — jamais depuis currentBalance. */
  async getBalance(companyId: string, id: string) {
    const cash = await this.getOrThrow(companyId, id);
    const rows: Array<{ debit: string; credit: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId} AND l.account_id = ${cash.accountId} AND e.status <> 'DRAFT'
    `;
    const totalDebit = Number(rows[0].debit);
    const totalCredit = Number(rows[0].credit);
    const balance = totalDebit - totalCredit;
    return { totalDebit, totalCredit, balance: Math.abs(balance), side: balance >= 0 ? ('DEBIT' as const) : ('CREDIT' as const) };
  }

  async listMovements(companyId: string, id: string, filters: ListCashMovementsDto) {
    await this.getOrThrow(companyId, id);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: any = { cashAccountId: id, companyId };
    if (filters.startDate || filters.endDate) {
      where.transactionDate = {};
      if (filters.startDate) where.transactionDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.transactionDate.lte = new Date(filters.endDate);
    }
    const [total, transactions] = await Promise.all([
      this.prisma.cashTransaction.count({ where }),
      this.prisma.cashTransaction.findMany({ where, orderBy: { transactionDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { transactions, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // =====================================================================
  // MOUVEMENTS
  // =====================================================================

  async createMovement(companyId: string, cashAccountId: string, userId: string, dto: CreateCashMovementDto, meta: RequestMetadata) {
    const cash = await this.getOrThrow(companyId, cashAccountId);
    if (!cash.isActive) throw new ForbiddenException('Cette caisse est désactivée.');

    const counterpart = await this.prisma.account.findUnique({ where: { id: dto.counterpartAccountId } });
    if (!counterpart || counterpart.companyId !== companyId) throw new BadRequestException('Compte de contrepartie introuvable pour cette entreprise.');
    if (!counterpart.isActive) throw new BadRequestException('Le compte de contrepartie est désactivé.');
    if (!counterpart.isPostable) throw new BadRequestException('Le compte de contrepartie doit être un compte de mouvement.');

    const entryDate = new Date(dto.transactionDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: entryDate }, endDate: { gte: entryDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: 'CASH' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException("Aucun journal actif de type CASH configuré pour cette entreprise — créez-en un avant d'enregistrer un mouvement.");

    const lines =
      dto.type === 'RECEIPT'
        ? [
            { accountId: cash.accountId, side: 'DEBIT' as const },
            { accountId: dto.counterpartAccountId, side: 'CREDIT' as const },
          ]
        : [
            { accountId: dto.counterpartAccountId, side: 'DEBIT' as const },
            { accountId: cash.accountId, side: 'CREDIT' as const },
          ];

    const result = await this.prisma.$transaction(async (tx: any) => {
      const entryNumRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journal.code}) as number
      `;
      const entryNumber = `${journal.code}-${entryNumRows[0].number}`;

      const entry = await tx.accountingEntry.create({
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
          totalDebit: dto.amount,
          totalCredit: dto.amount,
          lines: { create: lines.map((l, i) => ({ accountId: l.accountId, companyId, lineNumber: i + 1, side: l.side, amount: dto.amount, label: dto.label })) },
        },
      });
      await tx.accountingEntry.update({ where: { id: entry.id }, data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() } });

      const txNumRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'CASH_TRANSACTION'::"SequenceDocumentType", ${cashAccountId}) as number
      `;
      const movement = await tx.cashTransaction.create({
        data: {
          cashAccountId,
          companyId,
          type: dto.type,
          amount: dto.amount,
          transactionDate: entryDate,
          label: dto.label,
          reference: dto.reference ?? `CT-${txNumRows[0].number}`,
          linkedEntryId: entry.id,
        },
      });
      return movement;
    });

    await this.audit('CREATE', userId, companyId, 'CashTransaction', result.id, null, { type: dto.type, amount: dto.amount }, meta);
    return result;
  }

  /** Transfert entre deux caisses — une seule écriture, deux CashTransaction, atomique. */
  async createTransfer(companyId: string, sourceCashAccountId: string, userId: string, dto: CreateCashTransferDto, meta: RequestMetadata) {
    const source = await this.getOrThrow(companyId, sourceCashAccountId);
    const destination = await this.getOrThrow(companyId, dto.destinationCashAccountId);
    if (!source.isActive || !destination.isActive) throw new ForbiddenException('Les deux caisses doivent être actives.');
    if (source.id === destination.id) throw new BadRequestException('La caisse de destination doit être différente de la caisse source.');

    const entryDate = new Date(dto.transactionDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: entryDate }, endDate: { gte: entryDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: 'CASH' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException('Aucun journal actif de type CASH configuré pour cette entreprise.');

    const label = dto.label ?? `Transfert ${source.name} -> ${destination.name}`;

    const result = await this.prisma.$transaction(async (tx: any) => {
      const entryNumRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journal.code}) as number
      `;
      const entryNumber = `${journal.code}-${entryNumRows[0].number}`;

      const entry = await tx.accountingEntry.create({
        data: {
          companyId,
          periodId: period.id,
          journalId: journal.id,
          entryNumber,
          entryDate,
          label,
          status: 'DRAFT',
          createdById: userId,
          totalDebit: dto.amount,
          totalCredit: dto.amount,
          lines: {
            create: [
              { accountId: destination.accountId, companyId, lineNumber: 1, side: 'DEBIT', amount: dto.amount, label },
              { accountId: source.accountId, companyId, lineNumber: 2, side: 'CREDIT', amount: dto.amount, label },
            ],
          },
        },
      });
      await tx.accountingEntry.update({ where: { id: entry.id }, data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() } });

      const outNumRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'CASH_TRANSACTION'::"SequenceDocumentType", ${source.id}) as number
      `;
      const disbursement = await tx.cashTransaction.create({
        data: { cashAccountId: source.id, companyId, type: 'DISBURSEMENT', amount: dto.amount, transactionDate: entryDate, label, reference: `CT-${outNumRows[0].number}`, linkedEntryId: entry.id },
      });
      const inNumRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'CASH_TRANSACTION'::"SequenceDocumentType", ${destination.id}) as number
      `;
      const receipt = await tx.cashTransaction.create({
        data: { cashAccountId: destination.id, companyId, type: 'RECEIPT', amount: dto.amount, transactionDate: entryDate, label, reference: `CT-${inNumRows[0].number}`, linkedEntryId: entry.id },
      });

      return { entry, disbursement, receipt };
    });

    await this.audit('CREATE', userId, companyId, 'CashTransaction', result.entry.id, null, { transfer: true, from: source.id, to: destination.id, amount: dto.amount }, meta);
    return result;
  }

  /**
   * Transfert croisé caisse -> banque (Étape 11, Phase 7). Une seule
   * écriture (Débit compte bancaire / Crédit compte caisse), une
   * CashTransaction (DISBURSEMENT) et une BankTransaction (CREDIT,
   * source=BOOK) partageant la même écriture — atomique.
   */
  async createTransferToBank(companyId: string, sourceCashAccountId: string, destinationBankAccountId: string, amount: number, transactionDate: string, userId: string, label: string | undefined, meta: RequestMetadata) {
    const source = await this.getOrThrow(companyId, sourceCashAccountId);
    const destination = await this.prisma.bankAccount.findUnique({ where: { id: destinationBankAccountId } });
    if (!destination || destination.companyId !== companyId) throw new NotFoundException('Compte bancaire de destination introuvable pour cette entreprise.');
    if (!source.isActive || !destination.isActive) throw new ForbiddenException('La caisse et le compte bancaire doivent être actifs.');

    const entryDate = new Date(transactionDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: entryDate }, endDate: { gte: entryDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: 'CASH' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException('Aucun journal actif de type CASH configuré pour cette entreprise.');

    const finalLabel = label ?? `Transfert ${source.name} -> ${destination.name} (banque)`;

    const result = await this.prisma.$transaction(async (tx: any) => {
      const entryNumRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journal.code}) as number
      `;
      const entryNumber = `${journal.code}-${entryNumRows[0].number}`;

      const entry = await tx.accountingEntry.create({
        data: {
          companyId, periodId: period.id, journalId: journal.id, entryNumber, entryDate, label: finalLabel, status: 'DRAFT', createdById: userId,
          totalDebit: amount, totalCredit: amount,
          lines: {
            create: [
              { accountId: destination.accountId, companyId, lineNumber: 1, side: 'DEBIT', amount, label: finalLabel },
              { accountId: source.accountId, companyId, lineNumber: 2, side: 'CREDIT', amount, label: finalLabel },
            ],
          },
        },
      });
      await tx.accountingEntry.update({ where: { id: entry.id }, data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() } });

      const outNumRows: Array<{ number: string }> = await tx.$queryRaw`SELECT fn_next_document_number(${companyId}, 'CASH_TRANSACTION'::"SequenceDocumentType", ${source.id}) as number`;
      const disbursement = await tx.cashTransaction.create({
        data: { cashAccountId: source.id, companyId, type: 'DISBURSEMENT', amount, transactionDate: entryDate, label: finalLabel, reference: `CT-${outNumRows[0].number}`, linkedEntryId: entry.id },
      });
      const inNumRows: Array<{ number: string }> = await tx.$queryRaw`SELECT fn_next_document_number(${companyId}, 'BANK_TRANSACTION'::"SequenceDocumentType", ${destination.id}) as number`;
      const receipt = await tx.bankTransaction.create({
        data: { bankAccountId: destination.id, companyId, type: 'CREDIT', source: 'BOOK', amount, transactionDate: entryDate, label: finalLabel, reference: `BT-${inNumRows[0].number}`, linkedEntryId: entry.id },
      });
      return { entry, disbursement, receipt };
    });

    await this.audit('CREATE', userId, companyId, 'CashTransaction', result.entry.id, null, { crossTransfer: true, from: source.id, to: destination.id, amount }, meta);
    return result;
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private async validateTreasuryAccount(companyId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== companyId) throw new NotFoundException('Compte comptable introuvable pour cette entreprise.');
    if (!account.isPostable) throw new BadRequestException('Le compte associé doit être un compte de mouvement (postable).');
  }

  private async getOrThrow(companyId: string, id: string, include?: any) {
    const cash = await this.prisma.cashAccount.findUnique({ where: { id }, include });
    if (!cash || cash.companyId !== companyId) throw new NotFoundException('Caisse introuvable pour cette entreprise.');
    return cash;
  }

  private async audit(action: string, userId: string, companyId: string, entityType: string, entityId: string, oldValue: unknown, newValue: unknown, meta: RequestMetadata): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { userId, companyId, action: action as any, entityType, entityId, oldValue: oldValue as any, newValue: newValue as any, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      });
    } catch {
      // best-effort
    }
  }
}
