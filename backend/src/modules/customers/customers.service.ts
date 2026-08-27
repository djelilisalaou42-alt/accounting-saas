import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Le compte comptable d'un client doit être un compte de tiers (classe
 * 4, même métadonnée que le lettrage à l'Étape 9) — jamais un numéro
 * de compte codé en dur. Le solde d'un client réutilise EXACTEMENT la
 * même convention que le Grand Livre (Étape 8) : solde = débit −
 * crédit, filtré en plus par `partnerId`/`partnerType` sur les lignes
 * de son compte — aucune seconde convention créée.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, filters: ListCustomersDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: any = { companyId };
    if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';
    if (filters.search) {
      where.OR = [
        { code: { contains: filters.search, mode: 'insensitive' } },
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        include: { account: { select: { code: true, label: true } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { customers, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async get(companyId: string, id: string) {
    return this.getOrThrow(companyId, id, { account: { select: { code: true, label: true } } });
  }

  async create(companyId: string, userId: string, dto: CreateCustomerDto, meta: RequestMetadata) {
    await this.validateTiersAccount(companyId, dto.accountId);

    const existing = await this.prisma.customer.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Le code client "${dto.code}" existe déjà pour cette entreprise.`);

    const customer = await this.prisma.customer.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        taxIdNumber: dto.taxIdNumber,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        country: dto.country,
        accountId: dto.accountId,
        paymentTermDays: dto.paymentTermDays ?? 30,
      },
    });

    await this.audit('CREATE', userId, companyId, 'Customer', customer.id, null, { code: customer.code, name: customer.name }, meta);
    return customer;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateCustomerDto, meta: RequestMetadata) {
    const before = await this.getOrThrow(companyId, id);
    if (dto.accountId) await this.validateTiersAccount(companyId, dto.accountId);

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        taxIdNumber: dto.taxIdNumber,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        country: dto.country,
        accountId: dto.accountId,
        paymentTermDays: dto.paymentTermDays,
      },
    });

    await this.audit('UPDATE', userId, companyId, 'Customer', id, { name: before.name }, { name: updated.name }, meta);
    return updated;
  }

  async disable(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, id);
    const updated = await this.prisma.customer.update({ where: { id }, data: { isActive: false } });
    await this.audit('UPDATE', userId, companyId, 'Customer', id, null, { isActive: false }, meta);
    return updated;
  }

  async enable(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, id);
    const updated = await this.prisma.customer.update({ where: { id }, data: { isActive: true } });
    await this.audit('UPDATE', userId, companyId, 'Customer', id, null, { isActive: true }, meta);
    return updated;
  }

  /**
   * Solde comptable du client — même convention que le Grand Livre
   * (Étape 8) : solde = débit − crédit, sur les lignes VALIDATED/
   * REVERSED (jamais DRAFT) de son compte, filtrées par partnerId.
   */
  async getBalance(companyId: string, id: string) {
    const customer = await this.getOrThrow(companyId, id);
    if (!customer.accountId) {
      return { totalDebit: 0, totalCredit: 0, balance: 0, side: 'DEBIT' as const };
    }
    const rows: Array<{ debit: string; credit: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}
        AND l.account_id = ${customer.accountId}
        AND l.partner_type = 'CUSTOMER' AND l.partner_id = ${id}
        AND e.status <> 'DRAFT'
    `;
    const totalDebit = Number(rows[0].debit);
    const totalCredit = Number(rows[0].credit);
    const balance = totalDebit - totalCredit;
    return { totalDebit, totalCredit, balance: Math.abs(balance), side: balance >= 0 ? ('DEBIT' as const) : ('CREDIT' as const) };
  }

  async getHistory(companyId: string, id: string) {
    const customer = await this.getOrThrow(companyId, id);
    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { companyId, customerId: id },
        orderBy: { issueDate: 'desc' },
        select: { id: true, invoiceNumber: true, issueDate: true, dueDate: true, status: true, total: true, amountPaid: true },
      }),
      this.prisma.payment.findMany({
        where: { companyId, customerId: id },
        orderBy: { paymentDate: 'desc' },
        select: { id: true, paymentNumber: true, paymentDate: true, amount: true, method: true, direction: true },
      }),
    ]);
    // Historique du lettrage : lignes du compte du client rattachées à
    // un lettrage (réutilise le modèle Lettering existant, Étape 9).
    let letterings: any[] = [];
    if (customer.accountId) {
      letterings = await this.prisma.$queryRaw`
        SELECT DISTINCT lt.id, lt.code, lt.is_balanced, lt.canceled_at
        FROM letterings lt
        JOIN accounting_entry_lines l ON l.lettering_id = lt.id
        WHERE lt.company_id = ${companyId} AND l.partner_type = 'CUSTOMER' AND l.partner_id = ${id}
      `;
    }
    return { invoices, payments, letterings };
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private async validateTiersAccount(companyId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, include: { accountClass: true } });
    if (!account || account.companyId !== companyId) {
      throw new NotFoundException('Compte comptable introuvable pour cette entreprise.');
    }
    if (!account.isPostable) {
      throw new BadRequestException('Le compte associé doit être un compte de mouvement (postable).');
    }
    if (account.accountClass.code !== '4') {
      throw new BadRequestException(
        `Le compte associé à un client doit être un compte de tiers (classe "${account.accountClass.name}" trouvée, classe "4 — Comptes de tiers" attendue).`,
      );
    }
  }

  private async getOrThrow(companyId: string, id: string, include?: any) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, include });
    if (!customer || customer.companyId !== companyId) {
      throw new NotFoundException('Client introuvable pour cette entreprise.');
    }
    return customer;
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
        data: { userId, companyId, action: action as any, entityType, entityId, oldValue: oldValue as any, newValue: newValue as any, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      });
    } catch {
      // L'audit ne doit jamais faire échouer l'action métier elle-même.
    }
  }
}
