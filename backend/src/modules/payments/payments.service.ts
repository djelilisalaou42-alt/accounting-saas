import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * =====================================================================
 * AFFECTATION (Phase 10) — source de vérité : `PaymentAllocation`
 * (Étape 10, migration dédiée — `Payment.invoiceId` seul ne pouvait pas
 * représenter un paiement réparti sur plusieurs factures). Règles
 * vérifiées AVANT toute écriture, puis revérifiées par le trigger SQL
 * `fn_check_allocation_not_overpaid` (défense en profondeur, même
 * principe que les autres étapes) :
 *   - somme des affectations ≤ montant du paiement ;
 *   - somme des affectations d'une facture ≤ total de la facture.
 * Le statut de la facture (PARTIALLY_PAID / PAID) est recalculé depuis
 * la somme réelle des affectations, jamais depuis Payment.amount seul.
 *
 * ÉCRITURE COMPTABLE (Phase 11) — même pattern DRAFT→lignes→VALIDATED
 * que les factures (Étape 7/10) :
 *   Encaissement (INCOMING) : Débit trésorerie / Crédit compte client.
 *   Décaissement (OUTGOING) : Débit compte fournisseur / Crédit trésorerie.
 * =====================================================================
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liste minimale des comptes de trésorerie déjà configurés (modèles
   * `CashAccount`/`BankAccount` existants depuis les étapes
   * précédentes) — nécessaire pour permettre la sélection du compte
   * de trésorerie à la création d'un paiement. Ne constitue PAS un
   * module complet de gestion de trésorerie (hors périmètre de
   * l'Étape 10, réservé à une étape ultérieure — CashModule/BankModule
   * restent des stubs non implémentés).
   */
  async listTreasuryAccounts(companyId: string) {
    const [cashAccounts, bankAccounts] = await Promise.all([
      this.prisma.cashAccount.findMany({ where: { companyId }, select: { id: true, name: true, currency: true } }),
      this.prisma.bankAccount.findMany({ where: { companyId }, select: { id: true, bankName: true, accountNumber: true, currency: true } }),
    ]);
    return { cashAccounts, bankAccounts };
  }

  async list(companyId: string, filters: ListPaymentsDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: any = { companyId };
    if (filters.direction) where.direction = filters.direction;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.supplierId) where.supplierId = filters.supplierId;
    if (filters.search) where.paymentNumber = { contains: filters.search, mode: 'insensitive' };

    const [total, payments] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: { customer: { select: { code: true, name: true } }, supplier: { select: { code: true, name: true } } },
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { payments, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async get(companyId: string, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        customer: true,
        supplier: true,
        allocations: { include: { invoice: { select: { id: true, invoiceNumber: true, total: true } } } },
      },
    });
    if (!payment || payment.companyId !== companyId) throw new NotFoundException('Paiement introuvable pour cette entreprise.');
    return payment;
  }

  async create(companyId: string, userId: string, dto: CreatePaymentDto, meta: RequestMetadata) {
    if (dto.direction === 'INCOMING') {
      if (!dto.customerId) throw new BadRequestException('Un encaissement doit référencer un client.');
      const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
      if (!customer || customer.companyId !== companyId) throw new BadRequestException('Client introuvable pour cette entreprise.');
      if (!customer.accountId) throw new BadRequestException('Ce client n\'a pas de compte comptable configuré.');
    } else {
      if (!dto.supplierId) throw new BadRequestException('Un décaissement doit référencer un fournisseur.');
      const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier || supplier.companyId !== companyId) throw new BadRequestException('Fournisseur introuvable pour cette entreprise.');
      if (!supplier.accountId) throw new BadRequestException('Ce fournisseur n\'a pas de compte comptable configuré.');
    }

    if (!dto.cashAccountId && !dto.bankAccountId) {
      throw new BadRequestException('Un compte de trésorerie (caisse ou banque) est requis.');
    }
    if (dto.cashAccountId && dto.bankAccountId) {
      throw new BadRequestException('Choisissez soit un compte de caisse, soit un compte bancaire, pas les deux.');
    }

    // Validation des affectations : appartenance, montants.
    const allocations = dto.allocations ?? [];
    const allocatedSum = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    if (allocatedSum > dto.amount + 0.001) {
      throw new BadRequestException(`Le total affecté (${allocatedSum}) dépasse le montant du paiement (${dto.amount}).`);
    }
    const invoicesById = new Map<string, any>();
    for (const alloc of allocations) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: alloc.invoiceId } });
      if (!invoice || invoice.companyId !== companyId) throw new BadRequestException('Une facture affectée est introuvable pour cette entreprise.');
      if (dto.direction === 'INCOMING' && invoice.customerId !== dto.customerId) {
        throw new BadRequestException('Une facture affectée n\'appartient pas au client de ce paiement.');
      }
      if (dto.direction === 'OUTGOING' && invoice.supplierId !== dto.supplierId) {
        throw new BadRequestException('Une facture affectée n\'appartient pas au fournisseur de ce paiement.');
      }
      const remaining = Number(invoice.total) - Number(invoice.amountPaid);
      if (alloc.amount > remaining + 0.001) {
        throw new BadRequestException(`Le montant affecté à la facture ${invoice.invoiceNumber} (${alloc.amount}) dépasse son solde restant (${remaining}).`);
      }
      invoicesById.set(invoice.id, invoice);
    }

    const payment = await this.prisma.$transaction(async (tx: any) => {
      const numRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'PAYMENT'::"SequenceDocumentType", ${dto.direction}) as number
      `;
      const paymentNumber = `${dto.direction === 'INCOMING' ? 'ENC' : 'DEC'}-${numRows[0].number}`;

      const created = await tx.payment.create({
        data: {
          companyId,
          paymentNumber,
          customerId: dto.customerId,
          supplierId: dto.supplierId,
          direction: dto.direction,
          method: dto.method,
          amount: dto.amount,
          paymentDate: new Date(dto.paymentDate),
          reference: dto.reference,
          notes: dto.notes,
          cashAccountId: dto.cashAccountId,
          bankAccountId: dto.bankAccountId,
          invoiceId: allocations.length === 1 ? allocations[0].invoiceId : undefined,
        },
      });

      // Affectations — le trigger fn_check_allocation_not_overpaid
      // (Étape 10) revérifie indépendamment chaque insertion.
      for (const alloc of allocations) {
        await tx.paymentAllocation.create({
          data: { paymentId: created.id, invoiceId: alloc.invoiceId, companyId, amount: alloc.amount },
        });
        const invoice = invoicesById.get(alloc.invoiceId);
        const newAmountPaid = Math.round((Number(invoice.amountPaid) + alloc.amount) * 100) / 100;
        const newStatus = newAmountPaid >= Number(invoice.total) - 0.001 ? 'PAID' : 'PARTIALLY_PAID';
        await tx.invoice.update({ where: { id: alloc.invoiceId }, data: { amountPaid: newAmountPaid, status: newStatus } });
      }

      return created;
    });

    // Écriture comptable (hors transaction précédente pour garder des
    // blocs courts — mais toujours transactionnelle en elle-même,
    // même pattern DRAFT->lignes->VALIDATED que les factures).
    await this.generateAccountingEntry(companyId, payment.id, userId, dto);

    await this.audit('CREATE', userId, companyId, 'Payment', payment.id, null, { paymentNumber: payment.paymentNumber, amount: dto.amount }, meta);
    return this.get(companyId, payment.id);
  }

  async update(companyId: string, id: string, userId: string, dto: UpdatePaymentDto, meta: RequestMetadata) {
    await this.getOrThrow(companyId, id);
    const updated = await this.prisma.payment.update({ where: { id }, data: { reference: dto.reference, notes: dto.notes } });
    await this.audit('UPDATE', userId, companyId, 'Payment', id, null, { paymentNumber: updated.paymentNumber }, meta);
    return updated;
  }

  async cancel(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const payment = await this.getOrThrow(companyId, id, { allocations: true });

    await this.prisma.$transaction(async (tx: any) => {
      if (payment.linkedEntryId) {
        await this.reverseLinkedEntry(tx, companyId, payment.linkedEntryId, userId);
      }
      // Recalcul du solde de chaque facture affectée après retrait de
      // ce paiement — jamais depuis Payment.amount seul.
      for (const alloc of payment.allocations) {
        const invoice = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
        const newAmountPaid = Math.max(0, Math.round((Number(invoice.amountPaid) - Number(alloc.amount)) * 100) / 100);
        const newStatus = newAmountPaid <= 0 ? 'SENT' : newAmountPaid >= Number(invoice.total) - 0.001 ? 'PAID' : 'PARTIALLY_PAID';
        await tx.invoice.update({ where: { id: alloc.invoiceId }, data: { amountPaid: newAmountPaid, status: newStatus } });
      }
      await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
      await tx.payment.update({ where: { id }, data: { notes: `[ANNULÉ] ${payment.notes ?? ''}`.trim(), linkedEntryId: null } });
    });

    await this.audit('UPDATE', userId, companyId, 'Payment', id, null, { cancelled: true }, meta);
    return this.get(companyId, id);
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private async generateAccountingEntry(companyId: string, paymentId: string, userId: string, dto: CreatePaymentDto): Promise<void> {
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: new Date(dto.paymentDate) }, endDate: { gte: new Date(dto.paymentDate) } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre la date du paiement.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journalType = dto.cashAccountId ? 'CASH' : 'BANK';
    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: journalType as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException(`Aucun journal actif de type ${journalType} configuré pour cette entreprise.`);

    const treasuryAccountId = dto.cashAccountId
      ? (await this.prisma.cashAccount.findUnique({ where: { id: dto.cashAccountId } }))?.accountId
      : (await this.prisma.bankAccount.findUnique({ where: { id: dto.bankAccountId! } }))?.accountId;
    if (!treasuryAccountId) throw new BadRequestException('Compte de trésorerie introuvable ou mal configuré.');

    const partnerType = dto.direction === 'INCOMING' ? 'CUSTOMER' : 'SUPPLIER';
    const partnerId = dto.direction === 'INCOMING' ? dto.customerId! : dto.supplierId!;
    const tiersAccountId = dto.direction === 'INCOMING'
      ? (await this.prisma.customer.findUnique({ where: { id: dto.customerId! } }))?.accountId
      : (await this.prisma.supplier.findUnique({ where: { id: dto.supplierId! } }))?.accountId;
    if (!tiersAccountId) throw new BadRequestException('Compte comptable du tiers introuvable.');

    const lines =
      dto.direction === 'INCOMING'
        ? [
            { accountId: treasuryAccountId, side: 'DEBIT' as const, amount: dto.amount },
            { accountId: tiersAccountId, side: 'CREDIT' as const, amount: dto.amount, partnerType, partnerId },
          ]
        : [
            { accountId: tiersAccountId, side: 'DEBIT' as const, amount: dto.amount, partnerType, partnerId },
            { accountId: treasuryAccountId, side: 'CREDIT' as const, amount: dto.amount },
          ];

    await this.prisma.$transaction(async (tx: any) => {
      const numRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journal.code}) as number
      `;
      const entryNumber = `${journal.code}-${numRows[0].number}`;
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });

      const entry = await tx.accountingEntry.create({
        data: {
          companyId,
          periodId: period.id,
          journalId: journal.id,
          entryNumber,
          entryDate: new Date(dto.paymentDate),
          label: `Paiement ${payment.paymentNumber}`,
          reference: payment.paymentNumber,
          status: 'DRAFT',
          createdById: userId,
          totalDebit: dto.amount,
          totalCredit: dto.amount,
          lines: {
            create: lines.map((l, i) => ({
              accountId: l.accountId,
              companyId,
              lineNumber: i + 1,
              side: l.side,
              amount: l.amount,
              partnerType: (l as any).partnerType,
              partnerId: (l as any).partnerId,
            })),
          },
        },
      });
      await tx.accountingEntry.update({ where: { id: entry.id }, data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() } });
      await tx.payment.update({ where: { id: paymentId }, data: { linkedEntryId: entry.id } });
    });
  }

  private async reverseLinkedEntry(tx: any, companyId: string, entryId: string, userId: string): Promise<void> {
    const rows: any[] = await tx.$queryRaw`SELECT * FROM accounting_entries WHERE id = ${entryId} AND company_id = ${companyId} FOR UPDATE`;
    const original = rows[0];
    if (!original || original.status !== 'VALIDATED') return;

    const originalLines = await tx.accountingEntryLine.findMany({ where: { entryId }, orderBy: { lineNumber: 'asc' } });
    const journal = await tx.journal.findUnique({ where: { id: original.journal_id } });
    const numRows: Array<{ number: string }> = await tx.$queryRaw`
      SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journal.code}) as number
    `;
    const entryNumber = `${journal.code}-${numRows[0].number}`;

    const reversal = await tx.accountingEntry.create({
      data: {
        companyId,
        periodId: original.period_id,
        journalId: original.journal_id,
        entryNumber,
        entryDate: new Date(),
        label: `Annulation ${original.entry_number} — ${original.label}`,
        reference: original.reference,
        status: 'DRAFT',
        createdById: userId,
        reversalOfEntryId: entryId,
        totalDebit: original.total_credit,
        totalCredit: original.total_debit,
        lines: {
          create: originalLines.map((l: any, i: number) => ({
            accountId: l.accountId,
            companyId,
            lineNumber: i + 1,
            side: l.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
            amount: l.amount,
            label: l.label,
            partnerType: l.partnerType,
            partnerId: l.partnerId,
          })),
        },
      },
    });
    await tx.accountingEntry.update({ where: { id: reversal.id }, data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() } });
    await tx.accountingEntry.update({ where: { id: entryId }, data: { status: 'REVERSED' } });
  }

  private async getOrThrow(companyId: string, id: string, include?: any) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include });
    if (!payment || payment.companyId !== companyId) throw new NotFoundException('Paiement introuvable pour cette entreprise.');
    return payment;
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
