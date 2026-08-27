import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuoteDto, UpdateQuoteDto } from './dto/quote.dto';
import { ListQuotesDto } from './dto/list-quotes.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Les statuts réutilisent l'enum `DocumentStatus` déjà existant
 * (DRAFT/SENT/ACCEPTED/REFUSED/CANCELLED pour un devis — PARTIALLY_PAID/
 * PAID/OVERDUE ne concernent que les factures). Aucune notion de statut
 * "CONVERTED" séparée : la conversion est détectée via la relation
 * `Quote.invoice` déjà présente dans le modèle (`Invoice.quoteId` est
 * `@unique`, ce qui empêche nativement une double conversion — voir
 * `convertToInvoice`).
 */
@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, filters: ListQuotesDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: any = { companyId };
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.search) where.quoteNumber = { contains: filters.search, mode: 'insensitive' };

    const [total, quotes] = await Promise.all([
      this.prisma.quote.count({ where }),
      this.prisma.quote.findMany({
        where,
        include: { customer: { select: { code: true, name: true } }, invoice: { select: { id: true, invoiceNumber: true } } },
        orderBy: { issueDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { quotes, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async get(companyId: string, id: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: { customer: true, items: true, invoice: { select: { id: true, invoiceNumber: true } } },
    });
    if (!quote || quote.companyId !== companyId) throw new NotFoundException('Devis introuvable pour cette entreprise.');
    return quote;
  }

  async create(companyId: string, userId: string, dto: CreateQuoteDto, meta: RequestMetadata) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer || customer.companyId !== companyId) throw new BadRequestException('Client introuvable pour cette entreprise.');
    if (!customer.isActive) throw new BadRequestException('Ce client est désactivé.');

    const { items, subtotal, taxTotal, total } = this.computeItems(dto.items);

    const quote = await this.prisma.$transaction(async (tx: any) => {
      const numRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'QUOTE'::"SequenceDocumentType", '') as number
      `;
      const quoteNumber = `DV-${numRows[0].number}`;

      return tx.quote.create({
        data: {
          companyId,
          customerId: dto.customerId,
          quoteNumber,
          issueDate: new Date(dto.issueDate),
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          notes: dto.notes,
          subtotal,
          taxTotal,
          total,
          status: 'DRAFT',
          items: { create: items },
        },
        include: { items: true },
      });
    });

    await this.audit('CREATE', userId, companyId, 'Quote', quote.id, null, { quoteNumber: quote.quoteNumber }, meta);
    return quote;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateQuoteDto, meta: RequestMetadata) {
    const quote = await this.getOrThrow(companyId, id);
    if (quote.status !== 'DRAFT') throw new ForbiddenException('Seul un devis en brouillon peut être modifié.');

    let itemsData: ReturnType<typeof this.computeItems> | null = null;
    if (dto.items) itemsData = this.computeItems(dto.items);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      if (itemsData) await tx.quoteItem.deleteMany({ where: { quoteId: id } });
      return tx.quote.update({
        where: { id },
        data: {
          issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          notes: dto.notes,
          subtotal: itemsData?.subtotal,
          taxTotal: itemsData?.taxTotal,
          total: itemsData?.total,
          items: itemsData ? { create: itemsData.items } : undefined,
        },
        include: { items: true },
      });
    });

    await this.audit('UPDATE', userId, companyId, 'Quote', id, null, { quoteNumber: updated.quoteNumber }, meta);
    return updated;
  }

  async send(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const quote = await this.getOrThrow(companyId, id);
    if (quote.status !== 'DRAFT') throw new ConflictException('Seul un devis en brouillon peut être envoyé.');
    const updated = await this.prisma.quote.update({ where: { id }, data: { status: 'SENT' } });
    await this.audit('UPDATE', userId, companyId, 'Quote', id, { status: 'DRAFT' }, { status: 'SENT' }, meta);
    return updated;
  }

  async accept(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const quote = await this.getOrThrow(companyId, id);
    if (quote.status !== 'SENT') throw new ConflictException('Seul un devis envoyé peut être accepté.');
    const updated = await this.prisma.quote.update({ where: { id }, data: { status: 'ACCEPTED' } });
    await this.audit('UPDATE', userId, companyId, 'Quote', id, { status: 'SENT' }, { status: 'ACCEPTED' }, meta);
    return updated;
  }

  async reject(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const quote = await this.getOrThrow(companyId, id);
    if (quote.status !== 'SENT') throw new ConflictException('Seul un devis envoyé peut être refusé.');
    const updated = await this.prisma.quote.update({ where: { id }, data: { status: 'REFUSED' } });
    await this.audit('UPDATE', userId, companyId, 'Quote', id, { status: 'SENT' }, { status: 'REFUSED' }, meta);
    return updated;
  }

  async cancel(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const quote = await this.getOrThrow(companyId, id);
    if (quote.status === 'CANCELLED') throw new ConflictException('Ce devis est déjà annulé.');
    const updated = await this.prisma.quote.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit('UPDATE', userId, companyId, 'Quote', id, null, { status: 'CANCELLED' }, meta);
    return updated;
  }

  /**
   * Conversion devis -> facture, atomique et sûre en concurrence.
   *
   * La protection anti-double-conversion repose sur DEUX niveaux :
   * 1. Vérification applicative (quote.status === 'ACCEPTED' et
   *    quote.invoice === null) avant toute écriture.
   * 2. La contrainte `@@unique` déjà présente sur `Invoice.quoteId`
   *    (Étape 2) est la garantie ultime : si deux requêtes concurrentes
   *    passent la vérification applicative en même temps, UNE SEULE
   *    des deux insertions d'Invoice réussira — la seconde échoue sur
   *    la contrainte unique PostgreSQL, remonte une erreur claire, et
   *    n'est jamais silencieusement ignorée.
   */
  async convertToInvoice(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const quote = await this.prisma.quote.findUnique({ where: { id }, include: { items: true, invoice: true } });
    if (!quote || quote.companyId !== companyId) throw new NotFoundException('Devis introuvable pour cette entreprise.');
    if (quote.status !== 'ACCEPTED') throw new ConflictException('Seul un devis accepté peut être converti en facture.');
    if (quote.invoice) throw new ConflictException('Ce devis a déjà été converti en facture.');

    const today = new Date();
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: today }, endDate: { gte: today } } });
    if (!period || period.status !== 'OPEN') {
      throw new BadRequestException("Aucun exercice ouvert ne couvre la date du jour — impossible de générer la facture.");
    }

    let invoice;
    try {
      invoice = await this.prisma.$transaction(async (tx: any) => {
        const numRows: Array<{ number: string }> = await tx.$queryRaw`
          SELECT fn_next_document_number(${companyId}, 'INVOICE'::"SequenceDocumentType", 'SALE') as number
        `;
        const invoiceNumber = `FA-${numRows[0].number}`;
        const dueDate = new Date(today);
        const customer = await tx.customer.findUnique({ where: { id: quote.customerId } });
        dueDate.setDate(dueDate.getDate() + (customer?.paymentTermDays ?? 30));

        return tx.invoice.create({
          data: {
            companyId,
            customerId: quote.customerId,
            quoteId: quote.id,
            invoiceNumber,
            invoiceType: 'SALE',
            issueDate: today,
            dueDate,
            status: 'DRAFT',
            subtotal: quote.subtotal,
            taxTotal: quote.taxTotal,
            total: quote.total,
            items: {
              create: quote.items.map((it: any) => ({
                companyId,
                description: it.description,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                taxRate: it.taxRate,
                lineTotal: it.lineTotal,
              })),
            },
          },
          include: { items: true },
        });
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Contrainte unique Invoice.quoteId violée — une autre requête
        // concurrente a converti ce devis entre-temps.
        throw new ConflictException('Ce devis vient d\'être converti par une autre opération.');
      }
      throw err;
    }

    await this.audit('CREATE', userId, companyId, 'Invoice', invoice.id, null, { invoiceNumber: invoice.invoiceNumber, quoteId: quote.id }, meta);
    return invoice;
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private computeItems(items: Array<{ description: string; quantity: number; unitPrice: number; taxRate?: number }>) {
    let subtotal = 0;
    let taxTotal = 0;
    const computed = items.map((it) => {
      const lineSubtotal = Math.round(it.quantity * it.unitPrice * 100) / 100;
      const lineTax = Math.round(lineSubtotal * ((it.taxRate ?? 0) / 100) * 100) / 100;
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      return {
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRate: it.taxRate ?? 0,
        lineTotal: lineSubtotal,
      };
    });
    return { items: computed, subtotal: Math.round(subtotal * 100) / 100, taxTotal: Math.round(taxTotal * 100) / 100, total: Math.round((subtotal + taxTotal) * 100) / 100 };
  }

  private async getOrThrow(companyId: string, id: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id } });
    if (!quote || quote.companyId !== companyId) throw new NotFoundException('Devis introuvable pour cette entreprise.');
    return quote;
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
