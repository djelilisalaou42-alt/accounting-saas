import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { ListInvoicesDto } from './dto/list-invoices.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * =====================================================================
 * GÉNÉRATION D'ÉCRITURE (Phase 7/8/11) — règle centrale documentée ici.
 *
 * Une facture DRAFT n'est jamais comptabilisée. Au passage à SENT
 * ("émission" — réutilise le statut `DocumentStatus.SENT` déjà présent,
 * aucun statut "ISSUED" séparé inventé), le service :
 *   1. détermine l'exercice ouvert couvrant la date d'émission (jamais
 *      un exercice fourni par le client) ;
 *   2. sélectionne le premier journal actif de type SALES (vente) ou
 *      PURCHASES (achat) de l'entreprise — réutilise le module
 *      `journals` existant, n'en crée jamais un ;
 *   3. crée l'écriture en DRAFT AVEC ses lignes (jamais VALIDATED
 *      directement avec des lignes imbriquées — même bug que celui
 *      corrigé à l'Étape 7 pour la contrepassation) ;
 *   4. bascule l'écriture à VALIDATED dans un second appel — c'est
 *      cette transition que le trigger d'équilibre (Étape 3) vérifie
 *      réellement.
 *
 * Vente (SALE)   : Débit compte client (TTC) / Crédit comptes de
 *                  produits (HT par ligne) + Crédit TVA collectée.
 * Achat (PURCHASE): Débit comptes de charges (HT par ligne) + Débit
 *                  TVA récupérable / Crédit compte fournisseur (TTC).
 *
 * Chaque ligne côté tiers porte `partnerType`/`partnerId` (mécanisme
 * déjà existant sur `AccountingEntryLine`, réutilisé tel quel) — c'est
 * ce qui permet ensuite le calcul du solde client/fournisseur et le
 * lettrage (Étape 9) sans dupliquer de logique.
 * =====================================================================
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, filters: ListInvoicesDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: any = { companyId };
    if (filters.status) where.status = filters.status;
    if (filters.invoiceType) where.invoiceType = filters.invoiceType;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.supplierId) where.supplierId = filters.supplierId;
    if (filters.search) where.invoiceNumber = { contains: filters.search, mode: 'insensitive' };

    const [total, invoices] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: { customer: { select: { code: true, name: true } }, supplier: { select: { code: true, name: true } } },
        orderBy: { issueDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { invoices, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async get(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        supplier: true,
        items: { include: { account: { select: { code: true, label: true } } } },
        quote: { select: { id: true, quoteNumber: true } },
        payments: { select: { id: true, paymentNumber: true, amount: true, paymentDate: true } },
      },
    });
    if (!invoice || invoice.companyId !== companyId) throw new NotFoundException('Facture introuvable pour cette entreprise.');
    return invoice;
  }

  async create(companyId: string, userId: string, dto: CreateInvoiceDto, meta: RequestMetadata) {
    if (dto.invoiceType === 'SALE') {
      if (!dto.customerId) throw new BadRequestException('Une facture de vente doit référencer un client.');
      const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
      if (!customer || customer.companyId !== companyId) throw new BadRequestException('Client introuvable pour cette entreprise.');
      if (!customer.isActive) throw new BadRequestException('Ce client est désactivé.');
    } else {
      if (!dto.supplierId) throw new BadRequestException('Une facture d\'achat doit référencer un fournisseur.');
      const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier || supplier.companyId !== companyId) throw new BadRequestException('Fournisseur introuvable pour cette entreprise.');
      if (!supplier.isActive) throw new BadRequestException('Ce fournisseur est désactivé.');
    }

    const { items, subtotal, taxTotal, total } = await this.computeAndValidateItems(companyId, dto.items);
    if (taxTotal > 0 && !dto.taxAccountId) {
      throw new BadRequestException('Un compte de TVA est requis dès qu\'une ligne porte un taux de TVA.');
    }
    if (dto.taxAccountId) await this.validatePostableAccount(companyId, dto.taxAccountId);

    const invoice = await this.prisma.$transaction(async (tx: any) => {
      const scope = dto.invoiceType === 'SALE' ? 'SALE' : 'PURCHASE';
      const numRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'INVOICE'::"SequenceDocumentType", ${scope}) as number
      `;
      const invoiceNumber = `${dto.invoiceType === 'SALE' ? 'FA' : 'FF'}-${numRows[0].number}`;

      return tx.invoice.create({
        data: {
          companyId,
          customerId: dto.invoiceType === 'SALE' ? dto.customerId : undefined,
          supplierId: dto.invoiceType === 'PURCHASE' ? dto.supplierId : undefined,
          invoiceNumber,
          invoiceType: dto.invoiceType,
          issueDate: new Date(dto.issueDate),
          dueDate: new Date(dto.dueDate),
          status: 'DRAFT',
          taxAccountId: dto.taxAccountId,
          subtotal,
          taxTotal,
          total,
          notes: dto.notes,
          items: { create: items },
        },
        include: { items: true },
      });
    });

    await this.audit('CREATE', userId, companyId, 'Invoice', invoice.id, null, { invoiceNumber: invoice.invoiceNumber }, meta);
    return invoice;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateInvoiceDto, meta: RequestMetadata) {
    const invoice = await this.getOrThrow(companyId, id);
    if (invoice.status !== 'DRAFT') throw new ForbiddenException('Seule une facture en brouillon peut être modifiée.');

    let itemsData: Awaited<ReturnType<typeof this.computeAndValidateItems>> | null = null;
    if (dto.items) itemsData = await this.computeAndValidateItems(companyId, dto.items);
    if (dto.taxAccountId) await this.validatePostableAccount(companyId, dto.taxAccountId);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      if (itemsData) await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: {
          issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          notes: dto.notes,
          taxAccountId: dto.taxAccountId,
          subtotal: itemsData?.subtotal,
          taxTotal: itemsData?.taxTotal,
          total: itemsData?.total,
          items: itemsData ? { create: itemsData.items } : undefined,
        },
        include: { items: true },
      });
    });

    await this.audit('UPDATE', userId, companyId, 'Invoice', id, null, { invoiceNumber: updated.invoiceNumber }, meta);
    return updated;
  }

  /** Émission ("validation") — génère et valide l'écriture comptable. */
  async issue(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { items: true, customer: true, supplier: true } });
    if (!invoice || invoice.companyId !== companyId) throw new NotFoundException('Facture introuvable pour cette entreprise.');
    if (invoice.status !== 'DRAFT') throw new ConflictException('Seule une facture en brouillon peut être émise.');

    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: invoice.issueDate }, endDate: { gte: invoice.issueDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre la date de la facture.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    const journalType = invoice.invoiceType === 'SALE' ? 'SALES' : 'PURCHASES';
    const journal = await this.prisma.journal.findFirst({ where: { companyId, type: journalType as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) {
      throw new BadRequestException(`Aucun journal actif de type ${journalType} configuré pour cette entreprise — créez-en un avant d'émettre des factures.`);
    }

    const partnerType = invoice.invoiceType === 'SALE' ? 'CUSTOMER' : 'SUPPLIER';
    const partnerId = invoice.invoiceType === 'SALE' ? invoice.customerId : invoice.supplierId;
    const tiersAccountId = invoice.invoiceType === 'SALE' ? invoice.customer?.accountId : invoice.supplier?.accountId;
    if (!tiersAccountId) {
      throw new BadRequestException(`Le ${invoice.invoiceType === 'SALE' ? 'client' : 'fournisseur'} n'a pas de compte comptable configuré.`);
    }

    const lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; label?: string; partnerType?: string; partnerId?: string }> = [];
    if (invoice.invoiceType === 'SALE') {
      lines.push({ accountId: tiersAccountId, side: 'DEBIT', amount: Number(invoice.total), label: `Facture ${invoice.invoiceNumber}`, partnerType, partnerId: partnerId! });
      for (const item of invoice.items) {
        if (!item.accountId) throw new BadRequestException(`La ligne "${item.description}" n'a pas de compte associé.`);
        lines.push({ accountId: item.accountId, side: 'CREDIT', amount: Number(item.lineTotal), label: item.description });
      }
      if (Number(invoice.taxTotal) > 0) {
        if (!invoice.taxAccountId) throw new BadRequestException('Compte de TVA manquant.');
        lines.push({ accountId: invoice.taxAccountId, side: 'CREDIT', amount: Number(invoice.taxTotal), label: 'TVA collectée' });
      }
    } else {
      for (const item of invoice.items) {
        if (!item.accountId) throw new BadRequestException(`La ligne "${item.description}" n'a pas de compte associé.`);
        lines.push({ accountId: item.accountId, side: 'DEBIT', amount: Number(item.lineTotal), label: item.description });
      }
      if (Number(invoice.taxTotal) > 0) {
        if (!invoice.taxAccountId) throw new BadRequestException('Compte de TVA manquant.');
        lines.push({ accountId: invoice.taxAccountId, side: 'DEBIT', amount: Number(invoice.taxTotal), label: 'TVA récupérable' });
      }
      lines.push({ accountId: tiersAccountId, side: 'CREDIT', amount: Number(invoice.total), label: `Facture ${invoice.invoiceNumber}`, partnerType, partnerId: partnerId! });
    }

    // Vérification des comptes (actifs, postables) avant toute écriture.
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: accountIds } } });
    const byId = new Map(accounts.map((a: any) => [a.id, a]));
    for (const l of lines) {
      const acc: any = byId.get(l.accountId);
      if (!acc || acc.companyId !== companyId) throw new BadRequestException('Un compte utilisé pour la facture est introuvable pour cette entreprise.');
      if (!acc.isActive) throw new BadRequestException(`Le compte ${acc.code} est désactivé.`);
      if (!acc.isPostable) throw new BadRequestException(`Le compte ${acc.code} est un compte de regroupement (non mouvementable).`);
    }

    const entry = await this.prisma.$transaction(async (tx: any) => {
      const numRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journal.code}) as number
      `;
      const entryNumber = `${journal.code}-${numRows[0].number}`;

      const created = await tx.accountingEntry.create({
        data: {
          companyId,
          periodId: period.id,
          journalId: journal.id,
          entryNumber,
          entryDate: invoice.issueDate,
          label: `Facture ${invoice.invoiceNumber}`,
          reference: invoice.invoiceNumber,
          status: 'DRAFT',
          createdById: userId,
          totalDebit: lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0),
          totalCredit: lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.amount, 0),
          lines: {
            create: lines.map((l, i) => ({
              accountId: l.accountId,
              companyId,
              lineNumber: i + 1,
              side: l.side,
              amount: l.amount,
              label: l.label,
              partnerType: l.partnerType as any,
              partnerId: l.partnerId,
            })),
          },
        },
      });

      await tx.accountingEntry.update({ where: { id: created.id }, data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() } });

      await tx.invoice.update({ where: { id }, data: { status: 'SENT', linkedEntryId: created.id } });

      return created;
    });

    await this.audit('VALIDATE', userId, companyId, 'Invoice', id, { status: 'DRAFT' }, { status: 'SENT', entryId: entry.id }, meta);
    return this.get(companyId, id);
  }

  async cancel(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const invoice = await this.getOrThrow(companyId, id);
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      throw new ForbiddenException('Une facture partiellement ou totalement payée ne peut pas être annulée directement.');
    }
    if (invoice.status === 'CANCELLED') throw new ConflictException('Cette facture est déjà annulée.');

    await this.prisma.$transaction(async (tx: any) => {
      if (invoice.linkedEntryId) {
        // La facture était émise (écriture VALIDATED) : contrepassation
        // plutôt que suppression — même règle que l'Étape 7, jamais de
        // modification directe d'une écriture validée.
        await this.reverseLinkedEntry(tx, companyId, invoice.linkedEntryId, userId);
      }
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    });

    await this.audit('UPDATE', userId, companyId, 'Invoice', id, null, { status: 'CANCELLED' }, meta);
    return this.get(companyId, id);
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  /** Réutilise EXACTEMENT le pattern de contrepassation de l'Étape 7. */
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

  private async computeAndValidateItems(companyId: string, items: Array<{ description: string; quantity: number; unitPrice: number; taxRate?: number; accountId: string }>) {
    const accountIds = [...new Set(items.map((it) => it.accountId))];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: accountIds } } });
    const byId = new Map(accounts.map((a: any) => [a.id, a]));
    for (const it of items) {
      const acc: any = byId.get(it.accountId);
      if (!acc || acc.companyId !== companyId) throw new BadRequestException(`Compte introuvable pour la ligne "${it.description}".`);
      if (!acc.isPostable) throw new BadRequestException(`Le compte de la ligne "${it.description}" n'est pas un compte de mouvement.`);
    }

    let subtotal = 0;
    let taxTotal = 0;
    const computed = items.map((it) => {
      const lineSubtotal = Math.round(it.quantity * it.unitPrice * 100) / 100;
      const lineTax = Math.round(lineSubtotal * ((it.taxRate ?? 0) / 100) * 100) / 100;
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      return { description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, taxRate: it.taxRate ?? 0, lineTotal: lineSubtotal, accountId: it.accountId };
    });
    return { items: computed, subtotal: Math.round(subtotal * 100) / 100, taxTotal: Math.round(taxTotal * 100) / 100, total: Math.round((subtotal + taxTotal) * 100) / 100 };
  }

  private async validatePostableAccount(companyId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== companyId) throw new BadRequestException('Compte de TVA introuvable pour cette entreprise.');
    if (!account.isPostable) throw new BadRequestException('Le compte de TVA doit être un compte de mouvement.');
  }

  private async getOrThrow(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice || invoice.companyId !== companyId) throw new NotFoundException('Facture introuvable pour cette entreprise.');
    return invoice;
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
