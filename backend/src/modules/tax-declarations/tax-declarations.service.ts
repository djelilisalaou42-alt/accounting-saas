import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertCompanyTaxSettingsDto } from './dto/company-tax-settings.dto';
import { CreateTaxDeclarationDto, ListTaxDeclarationsDto, RecordTaxPaymentDto } from './dto/tax-declaration.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * =====================================================================
 * ÉTAPE 13 — Déclarations fiscales, calculées depuis les écritures
 * comptables réelles (jamais saisies manuellement — même exigence que
 * Budget.actualAmount, Étape 14).
 *
 * Pas de nouveau modèle de "période fiscale" : une déclaration
 * référence directement periodStart/periodEnd (déjà sur le modèle
 * existant) et sa validation vérifie que l'exercice comptable
 * (`AccountingPeriod`, Étape 6) couvrant periodEnd est OPEN — même
 * mécanisme réutilisé partout ailleurs (factures, trésorerie,
 * immobilisations), aucune seconde notion de période créée.
 *
 * TVA collectée/déductible calculées par mouvement NET (crédit − débit
 * pour le compte de TVA collectée, débit − crédit pour le compte de
 * TVA déductible) sur les écritures VALIDÉES de la période — même
 * requête agrégée que le Grand Livre/la Balance (Étape 8), jamais de
 * boucle applicative.
 * =====================================================================
 */
@Injectable()
export class TaxDeclarationsService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // CONFIGURATION FISCALE PAR ENTREPRISE
  // =====================================================================

  async listSettings(companyId: string) {
    return this.prisma.companyTaxSettings.findMany({
      where: { companyId },
      include: {
        tax: true,
        collectedAccount: { select: { code: true, label: true } },
        deductibleAccount: { select: { code: true, label: true } },
        payableAccount: { select: { code: true, label: true } },
      },
    });
  }

  async upsertSettings(companyId: string, userId: string, dto: UpsertCompanyTaxSettingsDto, meta: RequestMetadata) {
    const tax = await this.prisma.tax.findUnique({ where: { id: dto.taxId } });
    if (!tax) throw new NotFoundException('Taxe introuvable.');

    for (const accountId of [dto.collectedAccountId, dto.deductibleAccountId, dto.payableAccountId]) {
      if (accountId) await this.validatePostableAccount(companyId, accountId);
    }

    const existing = await this.prisma.companyTaxSettings.findUnique({ where: { companyId_taxId: { companyId, taxId: dto.taxId } } });
    const settings = existing
      ? await this.prisma.companyTaxSettings.update({
          where: { id: existing.id },
          data: { collectedAccountId: dto.collectedAccountId, deductibleAccountId: dto.deductibleAccountId, payableAccountId: dto.payableAccountId },
        })
      : await this.prisma.companyTaxSettings.create({
          data: { companyId, taxId: dto.taxId, collectedAccountId: dto.collectedAccountId, deductibleAccountId: dto.deductibleAccountId, payableAccountId: dto.payableAccountId },
        });

    await this.audit(existing ? 'UPDATE' : 'CREATE', userId, companyId, 'CompanyTaxSettings', settings.id, null, { taxId: dto.taxId }, meta);
    return settings;
  }

  async disableSettings(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const settings = await this.getSettingsOrThrow(companyId, id);
    if (!settings.isActive) throw new ConflictException('Cette configuration est déjà désactivée.');
    const updated = await this.prisma.companyTaxSettings.update({ where: { id }, data: { isActive: false } });
    await this.audit('UPDATE', userId, companyId, 'CompanyTaxSettings', id, { isActive: true }, { isActive: false }, meta);
    return updated;
  }

  async enableSettings(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const settings = await this.getSettingsOrThrow(companyId, id);
    if (settings.isActive) throw new ConflictException('Cette configuration est déjà active.');
    const updated = await this.prisma.companyTaxSettings.update({ where: { id }, data: { isActive: true } });
    await this.audit('UPDATE', userId, companyId, 'CompanyTaxSettings', id, { isActive: false }, { isActive: true }, meta);
    return updated;
  }

  // =====================================================================
  // DÉCLARATIONS FISCALES
  // =====================================================================

  async list(companyId: string, filters: ListTaxDeclarationsDto) {
    const where: any = { companyId };
    if (filters.taxId) where.taxId = filters.taxId;
    if (filters.status) where.status = filters.status;
    return this.prisma.taxDeclaration.findMany({
      where,
      include: { tax: { select: { code: true, label: true, type: true } } },
      orderBy: { periodStart: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOrThrow(companyId, id, { tax: true, linkedEntry: { select: { entryNumber: true, status: true } } });
  }

  /**
   * Calcule TVA collectée/déductible/nette/base imposable depuis les
   * VRAIES écritures comptables — jamais de saisie manuelle. Peut être
   * appelé en lecture seule (aperçu) ou lors de create/update tant que
   * la déclaration n'est pas encore validée.
   */
  private async computeAmounts(companyId: string, taxId: string, periodStart: Date, periodEnd: Date) {
    const settings = await this.prisma.companyTaxSettings.findUnique({ where: { companyId_taxId: { companyId, taxId } } });
    if (!settings) throw new BadRequestException("Aucune configuration fiscale (comptes) n'existe pour cette taxe dans cette entreprise — configurez-la avant de déclarer.");

    const tax = await this.prisma.tax.findUnique({ where: { id: taxId } });
    if (!tax) throw new NotFoundException('Taxe introuvable.');

    async function movement(prisma: PrismaService, accountId: string | null): Promise<{ debit: number; credit: number }> {
      if (!accountId) return { debit: 0, credit: 0 };
      const rows: Array<{ debit: string; credit: string }> = await prisma.$queryRaw`
        SELECT
          COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
          COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
        FROM accounting_entry_lines l
        JOIN accounting_entries e ON e.id = l.entry_id
        WHERE l.company_id = ${companyId}
          AND l.account_id = ${accountId}
          AND e.status <> 'DRAFT'
          AND e.entry_date BETWEEN ${periodStart} AND ${periodEnd}
      `;
      return { debit: Number(rows[0].debit), credit: Number(rows[0].credit) };
    }

    const collectedMovement = await movement(this.prisma, settings.collectedAccountId);
    const deductibleMovement = await movement(this.prisma, settings.deductibleAccountId);

    const collectedAmount = round2(collectedMovement.credit - collectedMovement.debit);
    const deductibleAmount = round2(deductibleMovement.debit - deductibleMovement.credit);
    const netAmount = round2(collectedAmount - deductibleAmount);
    const amountDue = netAmount > 0 ? netAmount : 0;
    const creditAmount = netAmount < 0 ? -netAmount : 0;
    // Base imposable reconstituée depuis la taxe collectée et le taux —
    // recap standard d'une déclaration de TVA (base = taxe / taux),
    // jamais une resaisie manuelle.
    const rate = Number(tax.rate);
    const taxableBase = rate > 0 ? round2(collectedAmount / (rate / 100)) : 0;

    return { collectedAmount, deductibleAmount, netAmount, amountDue, creditAmount, taxableBase, settings };
  }

  async create(companyId: string, userId: string, dto: CreateTaxDeclarationDto, meta: RequestMetadata) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);

    // Vérification applicative — message d'erreur clair, précède la
    // contrainte SQL unique (companyId, taxId, periodStart, periodEnd)
    // qui reste le dernier recours atomique sous concurrence.
    const existing = await this.prisma.taxDeclaration.findUnique({
      where: { companyId_taxId_periodStart_periodEnd: { companyId, taxId: dto.taxId, periodStart, periodEnd } },
    });
    if (existing) throw new ConflictException('Une déclaration existe déjà pour cette taxe et cette période.');

    const amounts = await this.computeAmounts(companyId, dto.taxId, periodStart, periodEnd);

    const declaration = await this.prisma.taxDeclaration.create({
      data: {
        companyId,
        taxId: dto.taxId,
        periodLabel: dto.periodLabel,
        periodStart,
        periodEnd,
        taxableBase: amounts.taxableBase,
        collectedAmount: amounts.collectedAmount,
        deductibleAmount: amounts.deductibleAmount,
        netAmount: amounts.netAmount,
        amountDue: amounts.amountDue,
        creditAmount: amounts.creditAmount,
        dueDate: new Date(dto.dueDate),
        status: 'DRAFT',
        createdById: userId,
      },
    });

    await this.audit('CREATE', userId, companyId, 'TaxDeclaration', declaration.id, null, { periodLabel: dto.periodLabel }, meta);
    return this.get(companyId, declaration.id);
  }

  /** Recalcule les montants depuis les écritures réelles — uniquement tant que non validée. */
  async recalculate(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const declaration = await this.getOrThrow(companyId, id);
    if (declaration.validatedAt) throw new ConflictException('Une déclaration validée ne peut plus être recalculée — elle est verrouillée.');

    const amounts = await this.computeAmounts(companyId, declaration.taxId, declaration.periodStart, declaration.periodEnd);
    await this.prisma.taxDeclaration.update({
      where: { id },
      data: {
        taxableBase: amounts.taxableBase,
        collectedAmount: amounts.collectedAmount,
        deductibleAmount: amounts.deductibleAmount,
        netAmount: amounts.netAmount,
        amountDue: amounts.amountDue,
        creditAmount: amounts.creditAmount,
      },
    });
    await this.audit('UPDATE', userId, companyId, 'TaxDeclaration', id, null, { recalculated: true }, meta);
    return this.get(companyId, id);
  }

  /**
   * Valide la déclaration : verrouille les montants (recalcul final),
   * génère l'écriture de TVA à décaisser/crédit de TVA, réutilisant
   * EXACTEMENT le pattern DRAFT -> lignes -> VALIDATED déjà en place
   * (Étapes 7/10/11/12) — jamais de seconde logique comptable créée.
   */
  async validate(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const declaration = await this.getOrThrow(companyId, id);
    if (declaration.validatedAt) throw new ConflictException('Cette déclaration a déjà été validée.');
    if (declaration.status !== 'DRAFT') throw new ConflictException('Seule une déclaration en brouillon peut être validée.');

    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: declaration.periodEnd }, endDate: { gte: declaration.periodEnd } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre la fin de cette période fiscale.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette période n'est pas ouvert.`);

    const amounts = await this.computeAmounts(companyId, declaration.taxId, declaration.periodStart, declaration.periodEnd);
    const settings = amounts.settings;
    if (!settings.collectedAccountId && !settings.deductibleAccountId) {
      throw new BadRequestException('Configuration fiscale incomplète (aucun compte de TVA collectée/déductible configuré).');
    }
    if (amounts.netAmount !== 0 && !settings.payableAccountId) {
      throw new BadRequestException('Compte de TVA à décaisser/crédit de TVA manquant dans la configuration fiscale.');
    }

    const declarationUpdated = await this.prisma.$transaction(async (tx: any) => {
      let linkedEntryId: string | null = null;
      if (amounts.collectedAmount > 0 || amounts.deductibleAmount > 0) {
        const lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; label: string }> = [];
        if (amounts.collectedAmount > 0) lines.push({ accountId: settings.collectedAccountId!, side: 'DEBIT', amount: amounts.collectedAmount, label: `TVA collectée ${declaration.periodLabel}` });
        if (amounts.deductibleAmount > 0) lines.push({ accountId: settings.deductibleAccountId!, side: 'CREDIT', amount: amounts.deductibleAmount, label: `TVA déductible ${declaration.periodLabel}` });
        if (amounts.netAmount > 0) lines.push({ accountId: settings.payableAccountId!, side: 'CREDIT', amount: amounts.netAmount, label: `TVA à décaisser ${declaration.periodLabel}` });
        else if (amounts.netAmount < 0) lines.push({ accountId: settings.payableAccountId!, side: 'DEBIT', amount: amounts.creditAmount, label: `Crédit de TVA ${declaration.periodLabel}` });

        linkedEntryId = await this.createBalancedEntry(tx, companyId, userId, {
          entryDate: declaration.periodEnd,
          label: `Déclaration ${declaration.periodLabel} — ${amounts.taxableBase >= 0 ? 'TVA' : 'Taxe'}`,
          reference: declaration.periodLabel,
          lines,
        });
      }

      return tx.taxDeclaration.update({
        where: { id },
        data: {
          taxableBase: amounts.taxableBase,
          collectedAmount: amounts.collectedAmount,
          deductibleAmount: amounts.deductibleAmount,
          netAmount: amounts.netAmount,
          amountDue: amounts.amountDue,
          creditAmount: amounts.creditAmount,
          linkedEntryId,
          validatedById: userId,
          validatedAt: new Date(),
        },
      });
    });

    await this.audit('VALIDATE', userId, companyId, 'TaxDeclaration', id, null, { amountDue: amounts.amountDue }, meta);
    return this.get(companyId, declarationUpdated.id);
  }

  /** Soumission officielle — nécessite une déclaration déjà validée (montants verrouillés). */
  async declare(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const declaration = await this.getOrThrow(companyId, id);
    if (!declaration.validatedAt) throw new ConflictException("Cette déclaration doit d'abord être validée avant d'être soumise.");
    if (declaration.status !== 'DRAFT') throw new ConflictException('Cette déclaration a déjà été soumise.');

    const updated = await this.prisma.taxDeclaration.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    await this.audit('VALIDATE', userId, companyId, 'TaxDeclaration', id, { status: 'DRAFT' }, { status: 'SUBMITTED' }, meta);
    return this.get(companyId, updated.id);
  }

  /** Enregistre un paiement (total ou partiel) — solde restant = amountDue - amountPaid. */
  async recordPayment(companyId: string, id: string, userId: string, dto: RecordTaxPaymentDto, meta: RequestMetadata) {
    const declaration = await this.getOrThrow(companyId, id);
    if (declaration.status !== 'SUBMITTED' && declaration.status !== 'LATE') {
      throw new ConflictException('Seule une déclaration soumise (ou en retard) peut recevoir un paiement.');
    }
    const newAmountPaid = round2(Number(declaration.amountPaid) + dto.amount);
    if (newAmountPaid > Number(declaration.amountDue)) {
      throw new BadRequestException(`Le paiement dépasse le solde restant (${round2(Number(declaration.amountDue) - Number(declaration.amountPaid))}).`);
    }
    const newStatus = newAmountPaid >= Number(declaration.amountDue) && Number(declaration.amountDue) > 0 ? 'PAID' : declaration.status;

    const updated = await this.prisma.taxDeclaration.update({
      where: { id },
      data: { amountPaid: newAmountPaid, status: newStatus as any, paidAt: newStatus === 'PAID' ? new Date(dto.paymentDate) : declaration.paidAt },
    });
    await this.audit('UPDATE', userId, companyId, 'TaxDeclaration', id, { amountPaid: declaration.amountPaid }, { amountPaid: newAmountPaid }, meta);
    return this.get(companyId, updated.id);
  }

  // =====================================================================
  // UTILITAIRES
  // =====================================================================

  /** Réutilise EXACTEMENT le pattern de numérotation/validation des Étapes 7/10/11/12. */
  private async createBalancedEntry(
    tx: any,
    companyId: string,
    userId: string,
    input: { entryDate: Date; label: string; reference?: string; lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; label?: string }> },
  ): Promise<string> {
    const journal = await tx.journal.findFirst({ where: { companyId, type: 'GENERAL' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException("Aucun journal actif de type GENERAL configuré pour cette entreprise.");

    const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } });
    const byId = new Map(accounts.map((a: any) => [a.id, a]));
    for (const l of input.lines) {
      const acc: any = byId.get(l.accountId);
      if (!acc || acc.companyId !== companyId) throw new BadRequestException('Un compte utilisé pour cette écriture est introuvable pour cette entreprise.');
      if (!acc.isActive) throw new BadRequestException(`Le compte ${acc.code} est désactivé.`);
      if (!acc.isPostable) throw new BadRequestException(`Le compte ${acc.code} est un compte de regroupement (non mouvementable).`);
    }

    const numRows: Array<{ number: string }> = await tx.$queryRaw`
      SELECT fn_next_document_number(${companyId}, 'ACCOUNTING_ENTRY'::"SequenceDocumentType", ${journal.code}) as number
    `;
    const entryNumber = `${journal.code}-${numRows[0].number}`;
    const periodRow = await tx.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: input.entryDate }, endDate: { gte: input.entryDate } } });

    const created = await tx.accountingEntry.create({
      data: {
        companyId,
        periodId: periodRow.id,
        journalId: journal.id,
        entryNumber,
        entryDate: input.entryDate,
        label: input.label,
        reference: input.reference,
        status: 'DRAFT',
        createdById: userId,
        totalDebit: input.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0),
        totalCredit: input.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.amount, 0),
        lines: {
          create: input.lines.map((l, i) => ({ accountId: l.accountId, companyId, lineNumber: i + 1, side: l.side, amount: l.amount, label: l.label })),
        },
      },
    });
    await tx.accountingEntry.update({ where: { id: created.id }, data: { status: 'VALIDATED', validatedById: userId, validatedAt: new Date() } });
    return created.id;
  }

  private async validatePostableAccount(companyId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== companyId) throw new NotFoundException('Compte comptable introuvable pour cette entreprise.');
    if (!account.isActive) throw new BadRequestException(`Le compte ${account.code} est désactivé.`);
    if (!account.isPostable) throw new BadRequestException(`Le compte ${account.code} est un compte de regroupement (non mouvementable).`);
  }

  private async getOrThrow(companyId: string, id: string, include?: any) {
    const declaration = await this.prisma.taxDeclaration.findUnique({ where: { id }, include });
    if (!declaration || declaration.companyId !== companyId) throw new NotFoundException('Déclaration fiscale introuvable pour cette entreprise.');
    return declaration;
  }

  private async getSettingsOrThrow(companyId: string, id: string) {
    const settings = await this.prisma.companyTaxSettings.findUnique({ where: { id } });
    if (!settings || settings.companyId !== companyId) throw new NotFoundException('Configuration fiscale introuvable pour cette entreprise.');
    return settings;
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
