import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';
import { CreateBankMovementDto, CreateBankTransferDto } from './dto/bank-movement.dto';
import { ListBankMovementsDto } from './dto/list-bank.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/** Symétrique à CashService — mêmes règles (solde recalculé, jamais stocké ; pattern DRAFT->lignes->VALIDATED). */
@Injectable()
export class BankService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId },
      include: { account: { select: { code: true, label: true } } },
      orderBy: { code: 'asc' },
    });
    // Numéro de compte masqué en liste — donnée sensible, jamais
    // exposée inutilement (Étape 11, Phase 5).
    return accounts.map((a: any) => ({ ...a, accountNumber: this.maskAccountNumber(a.accountNumber) }));
  }

  async get(companyId: string, id: string) {
    const account = await this.getOrThrow(companyId, id, { account: { select: { code: true, label: true } } });
    return account;
  }

  async create(companyId: string, userId: string, dto: CreateBankAccountDto, meta: RequestMetadata) {
    await this.validateTreasuryAccount(companyId, dto.accountId);
    const existing = await this.prisma.bankAccount.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Le code de compte bancaire "${dto.code}" existe déjà pour cette entreprise.`);

    const bank = await this.prisma.bankAccount.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        bankName: dto.bankName,
        iban: dto.iban,
        accountNumber: dto.accountNumber,
        swiftBic: dto.swiftBic,
        accountId: dto.accountId,
        currency: dto.currency ?? 'XOF',
        description: dto.description,
      },
    });
    // Jamais de donnée bancaire sensible dans l'audit (Étape 11, Phase 12).
    await this.audit('CREATE', userId, companyId, 'BankAccount', bank.id, null, { code: bank.code }, meta);
    return bank;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateBankAccountDto, meta: RequestMetadata) {
    const before = await this.getOrThrow(companyId, id);
    const updated = await this.prisma.bankAccount.update({ where: { id }, data: { name: dto.name, description: dto.description } });
    await this.audit('UPDATE', userId, companyId, 'BankAccount', id, { name: before.name }, { name: updated.name }, meta);
    return updated;
  }

  async disable(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, id);
    const updated = await this.prisma.bankAccount.update({ where: { id }, data: { isActive: false } });
    await this.audit('UPDATE', userId, companyId, 'BankAccount', id, null, { isActive: false }, meta);
    return updated;
  }

  async enable(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, id);
    const updated = await this.prisma.bankAccount.update({ where: { id }, data: { isActive: true } });
    await this.audit('UPDATE', userId, companyId, 'BankAccount', id, null, { isActive: true }, meta);
    return updated;
  }

  async getBalance(companyId: string, id: string) {
    const bank = await this.getOrThrow(companyId, id);
    const rows: Array<{ debit: string; credit: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId} AND l.account_id = ${bank.accountId} AND e.status <> 'DRAFT'
    `;
    const totalDebit = Number(rows[0].debit);
    const totalCredit = Number(rows[0].credit);
    const balance = totalDebit - totalCredit;
    return { totalDebit, totalCredit, balance: Math.abs(balance), side: balance >= 0 ? ('DEBIT' as const) : ('CREDIT' as const) };
  }

  async listMovements(companyId: string, id: string, filters: ListBankMovementsDto) {
    await this.getOrThrow(companyId, id);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: any = { bankAccountId: id, companyId, source: 'BOOK' };
    if (filters.startDate || filters.endDate) {
      where.transactionDate = {};
      if (filters.startDate) where.transactionDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.transactionDate.lte = new Date(filters.endDate);
    }
    const [total, transactions] = await Promise.all([
      this.prisma.bankTransaction.count({ where }),
      this.prisma.bankTransaction.findMany({ where, orderBy: { transactionDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { transactions, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async createMovement(companyId: string, bankAccountId: string, userId: string, dto: CreateBankMovementDto, meta: RequestMetadata) {
    const bank = await this.getOrThrow(companyId, bankAccountId);
    if (!bank.isActive) throw new ForbiddenException('Ce compte bancaire est désactivé.');

    const counterpart = await this.prisma.account.findUnique({ where: { id: dto.counterpartAccountId } });
    if (!counterpart || counterpart.companyId !== companyId) throw new BadRequestException('Compte de contrepartie introuvable pour cette entreprise.');
    if (!counterpart.isActive) throw new BadRequestException('Le compte de contrepartie est désactivé.');
    if (!counterpart.isPostable) throw new BadRequestException('Le compte de contrepartie doit être un compte de mouvement.');

    const entryDate = new Date(dto.transactionDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: entryDate }, endDate: { gte: entryDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: 'BANK' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException("Aucun journal actif de type BANK configuré pour cette entreprise.");

    // CREDIT (entrée en banque) : Débit banque / Crédit contrepartie.
    // DEBIT (sortie, y compris frais bancaires) : Débit contrepartie / Crédit banque.
    const lines =
      dto.type === 'CREDIT'
        ? [
            { accountId: bank.accountId, side: 'DEBIT' as const },
            { accountId: dto.counterpartAccountId, side: 'CREDIT' as const },
          ]
        : [
            { accountId: dto.counterpartAccountId, side: 'DEBIT' as const },
            { accountId: bank.accountId, side: 'CREDIT' as const },
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
        SELECT fn_next_document_number(${companyId}, 'BANK_TRANSACTION'::"SequenceDocumentType", ${bankAccountId}) as number
      `;
      const movement = await tx.bankTransaction.create({
        data: {
          bankAccountId,
          companyId,
          type: dto.type,
          source: 'BOOK',
          amount: dto.amount,
          transactionDate: entryDate,
          label: dto.label,
          reference: dto.reference ?? `BT-${txNumRows[0].number}`,
          linkedEntryId: entry.id,
        },
      });
      return movement;
    });

    await this.audit('CREATE', userId, companyId, 'BankTransaction', result.id, null, { type: dto.type, amount: dto.amount }, meta);
    return result;
  }

  /** Transfert entre comptes bancaires — une seule écriture, deux BankTransaction, atomique. */
  async createTransfer(companyId: string, sourceBankAccountId: string, userId: string, dto: CreateBankTransferDto, meta: RequestMetadata) {
    const source = await this.getOrThrow(companyId, sourceBankAccountId);
    const destination = await this.getOrThrow(companyId, dto.destinationBankAccountId);
    if (!source.isActive || !destination.isActive) throw new ForbiddenException('Les deux comptes bancaires doivent être actifs.');
    if (source.id === destination.id) throw new BadRequestException('Le compte de destination doit être différent du compte source.');

    const entryDate = new Date(dto.transactionDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: entryDate }, endDate: { gte: entryDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: 'BANK' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException('Aucun journal actif de type BANK configuré pour cette entreprise.');

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
        SELECT fn_next_document_number(${companyId}, 'BANK_TRANSACTION'::"SequenceDocumentType", ${source.id}) as number
      `;
      const debit = await tx.bankTransaction.create({
        data: { bankAccountId: source.id, companyId, type: 'DEBIT', source: 'BOOK', amount: dto.amount, transactionDate: entryDate, label, reference: `BT-${outNumRows[0].number}`, linkedEntryId: entry.id },
      });
      const inNumRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'BANK_TRANSACTION'::"SequenceDocumentType", ${destination.id}) as number
      `;
      const credit = await tx.bankTransaction.create({
        data: { bankAccountId: destination.id, companyId, type: 'CREDIT', source: 'BOOK', amount: dto.amount, transactionDate: entryDate, label, reference: `BT-${inNumRows[0].number}`, linkedEntryId: entry.id },
      });

      return { entry, debit, credit };
    });

    await this.audit('CREATE', userId, companyId, 'BankTransaction', result.entry.id, null, { transfer: true, from: source.id, to: destination.id, amount: dto.amount }, meta);
    return result;
  }

  /**
   * Transfert croisé banque -> caisse (Étape 11, Phase 7), symétrique
   * de `CashService.createTransferToBank`. Une seule écriture (Débit
   * compte caisse / Crédit compte bancaire), atomique.
   */
  async createTransferToCash(companyId: string, sourceBankAccountId: string, destinationCashAccountId: string, amount: number, transactionDate: string, userId: string, label: string | undefined, meta: RequestMetadata) {
    const source = await this.getOrThrow(companyId, sourceBankAccountId);
    const destination = await this.prisma.cashAccount.findUnique({ where: { id: destinationCashAccountId } });
    if (!destination || destination.companyId !== companyId) throw new NotFoundException('Caisse de destination introuvable pour cette entreprise.');
    if (!source.isActive || !destination.isActive) throw new ForbiddenException('Le compte bancaire et la caisse doivent être actifs.');

    const entryDate = new Date(transactionDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: entryDate }, endDate: { gte: entryDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: 'BANK' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException('Aucun journal actif de type BANK configuré pour cette entreprise.');

    const finalLabel = label ?? `Transfert ${source.name} -> ${destination.name} (caisse)`;

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

      const outNumRows: Array<{ number: string }> = await tx.$queryRaw`SELECT fn_next_document_number(${companyId}, 'BANK_TRANSACTION'::"SequenceDocumentType", ${source.id}) as number`;
      const debit = await tx.bankTransaction.create({
        data: { bankAccountId: source.id, companyId, type: 'DEBIT', source: 'BOOK', amount, transactionDate: entryDate, label: finalLabel, reference: `BT-${outNumRows[0].number}`, linkedEntryId: entry.id },
      });
      const inNumRows: Array<{ number: string }> = await tx.$queryRaw`SELECT fn_next_document_number(${companyId}, 'CASH_TRANSACTION'::"SequenceDocumentType", ${destination.id}) as number`;
      const receipt = await tx.cashTransaction.create({
        data: { cashAccountId: destination.id, companyId, type: 'RECEIPT', amount, transactionDate: entryDate, label: finalLabel, reference: `CT-${inNumRows[0].number}`, linkedEntryId: entry.id },
      });
      return { entry, debit, receipt };
    });

    await this.audit('CREATE', userId, companyId, 'BankTransaction', result.entry.id, null, { crossTransfer: true, from: source.id, to: destination.id, amount }, meta);
    return result;
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private maskAccountNumber(accountNumber: string | null): string | null {
    if (!accountNumber) return null;
    if (accountNumber.length <= 4) return '••••';
    return `••••${accountNumber.slice(-4)}`;
  }

  private async validateTreasuryAccount(companyId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== companyId) throw new NotFoundException('Compte comptable introuvable pour cette entreprise.');
    if (!account.isPostable) throw new BadRequestException('Le compte associé doit être un compte de mouvement (postable).');
  }

  private async getOrThrow(companyId: string, id: string, include?: any) {
    const bank = await this.prisma.bankAccount.findUnique({ where: { id }, include });
    if (!bank || bank.companyId !== companyId) throw new NotFoundException('Compte bancaire introuvable pour cette entreprise.');
    return bank;
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
