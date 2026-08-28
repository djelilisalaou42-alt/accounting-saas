import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssetCategoryDto, UpdateAssetCategoryDto } from './dto/asset-category.dto';
import { CreateFixedAssetDto, DisposeFixedAssetDto, GenerateDepreciationDto, UpdateFixedAssetDto } from './dto/fixed-asset.dto';
import { ListFixedAssetsDto } from './dto/list-fixed-assets.dto';
import { computeDepreciationSchedule, findScheduleLineForFiscalYear } from './depreciation-calculator';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * =====================================================================
 * ÉTAPE 12 — Immobilisations et amortissements.
 *
 * Cycle de vie d'une fiche : ACQUIRED -> IN_SERVICE -> (DISPOSED).
 * L'amortissement ne démarre JAMAIS avant la mise en service — le plan
 * s'ancre exclusivement sur serviceDate (voir depreciation-calculator.ts).
 *
 * Pattern DRAFT -> lignes -> VALIDATED strictement réutilisé pour
 * toute écriture générée (dotation, acquisition directe, cession),
 * même principe que les Étapes 7/10/11 — jamais de création directe
 * VALIDATED avec lignes imbriquées.
 *
 * Double dotation / double cession : protégées par une vérification
 * applicative (message d'erreur clair) PUIS par la contrainte SQL
 * unique en dernier recours (fixed_asset_id+fiscal_year sur
 * depreciation_entries, fixed_asset_id sur asset_disposals) — le
 * verrou de dernier recours est atomique côté PostgreSQL, contrairement
 * à la vérification applicative qui laisse une fenêtre de course sous
 * concurrence.
 * =====================================================================
 */
@Injectable()
export class FixedAssetsService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // CATÉGORIES
  // =====================================================================

  async listCategories(companyId: string) {
    return this.prisma.assetCategory.findMany({
      where: { companyId },
      include: {
        assetAccount: { select: { code: true, label: true } },
        depreciationAccount: { select: { code: true, label: true } },
        depreciationExpenseAccount: { select: { code: true, label: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  async getCategory(companyId: string, id: string) {
    return this.getCategoryOrThrow(companyId, id, {
      assetAccount: { select: { code: true, label: true } },
      depreciationAccount: { select: { code: true, label: true } },
      depreciationExpenseAccount: { select: { code: true, label: true } },
    });
  }

  async createCategory(companyId: string, userId: string, dto: CreateAssetCategoryDto, meta: RequestMetadata) {
    await this.validatePostableAccount(companyId, dto.assetAccountId);
    await this.validatePostableAccount(companyId, dto.depreciationAccountId);
    await this.validatePostableAccount(companyId, dto.depreciationExpenseAccountId);

    const existing = await this.prisma.assetCategory.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Le code de catégorie "${dto.code}" existe déjà pour cette entreprise.`);

    const category = await this.prisma.assetCategory.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        assetAccountId: dto.assetAccountId,
        depreciationAccountId: dto.depreciationAccountId,
        depreciationExpenseAccountId: dto.depreciationExpenseAccountId,
        defaultMethod: (dto.defaultMethod ?? 'STRAIGHT_LINE') as any,
        defaultUsefulLifeYears: dto.defaultUsefulLifeYears,
      },
    });
    await this.audit('CREATE', userId, companyId, 'AssetCategory', category.id, null, { code: category.code }, meta);
    return category;
  }

  async updateCategory(companyId: string, id: string, userId: string, dto: UpdateAssetCategoryDto, meta: RequestMetadata) {
    const before = await this.getCategoryOrThrow(companyId, id);
    if (dto.assetAccountId) await this.validatePostableAccount(companyId, dto.assetAccountId);
    if (dto.depreciationAccountId) await this.validatePostableAccount(companyId, dto.depreciationAccountId);
    if (dto.depreciationExpenseAccountId) await this.validatePostableAccount(companyId, dto.depreciationExpenseAccountId);

    const updated = await this.prisma.assetCategory.update({
      where: { id },
      data: {
        name: dto.name,
        assetAccountId: dto.assetAccountId,
        depreciationAccountId: dto.depreciationAccountId,
        depreciationExpenseAccountId: dto.depreciationExpenseAccountId,
        defaultMethod: dto.defaultMethod as any,
        defaultUsefulLifeYears: dto.defaultUsefulLifeYears,
      },
    });
    await this.audit('UPDATE', userId, companyId, 'AssetCategory', id, { name: before.name }, { name: updated.name }, meta);
    return updated;
  }

  async disableCategory(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const category = await this.getCategoryOrThrow(companyId, id);
    if (!category.isActive) throw new ConflictException('Cette catégorie est déjà désactivée.');
    const updated = await this.prisma.assetCategory.update({ where: { id }, data: { isActive: false } });
    await this.audit('UPDATE', userId, companyId, 'AssetCategory', id, { isActive: true }, { isActive: false }, meta);
    return updated;
  }

  async enableCategory(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const category = await this.getCategoryOrThrow(companyId, id);
    if (category.isActive) throw new ConflictException('Cette catégorie est déjà active.');
    const updated = await this.prisma.assetCategory.update({ where: { id }, data: { isActive: true } });
    await this.audit('UPDATE', userId, companyId, 'AssetCategory', id, { isActive: false }, { isActive: true }, meta);
    return updated;
  }

  // =====================================================================
  // IMMOBILISATIONS
  // =====================================================================

  async list(companyId: string, filters: ListFixedAssetsDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: any = { companyId };
    if (filters.status) where.status = filters.status;
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.search) {
      where.OR = [
        { code: { contains: filters.search, mode: 'insensitive' } },
        { label: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const [total, assets] = await Promise.all([
      this.prisma.fixedAsset.count({ where }),
      this.prisma.fixedAsset.findMany({
        where,
        include: { category: { select: { code: true, name: true } }, assetAccount: { select: { code: true, label: true } } },
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { assets, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async get(companyId: string, id: string) {
    return this.getOrThrow(companyId, id, {
      category: true,
      assetAccount: { select: { code: true, label: true } },
      depreciationAccount: { select: { code: true, label: true } },
      depreciationExpenseAccount: { select: { code: true, label: true } },
      supplier: { select: { code: true, name: true } },
      invoice: { select: { invoiceNumber: true } },
      depreciationEntries: { orderBy: { fiscalYear: 'asc' } },
      disposal: true,
    });
  }

  /** Plan d'amortissement prévisionnel — lecture seule, ne crée rien. */
  async getSchedule(companyId: string, id: string) {
    const asset = await this.getOrThrow(companyId, id);
    if (!asset.serviceDate) return { schedule: [], message: "L'immobilisation n'est pas encore en service." };
    const schedule = computeDepreciationSchedule({
      acquisitionCost: Number(asset.acquisitionCost),
      residualValue: Number(asset.residualValue),
      usefulLifeYears: asset.usefulLifeYears,
      method: asset.depreciationMethod as any,
      serviceDate: asset.serviceDate,
    });
    return { schedule };
  }

  async create(companyId: string, userId: string, dto: CreateFixedAssetDto, meta: RequestMetadata) {
    const existing = await this.prisma.fixedAsset.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Le code d'immobilisation "${dto.code}" existe déjà pour cette entreprise.`);

    let category: any = null;
    if (dto.categoryId) {
      category = await this.getCategoryOrThrow(companyId, dto.categoryId);
    }

    // Héritage optionnel des comptes depuis la catégorie si non fournis.
    const assetAccountId = dto.assetAccountId ?? category?.assetAccountId;
    const depreciationAccountId = dto.depreciationAccountId ?? category?.depreciationAccountId;
    const depreciationExpenseAccountId = dto.depreciationExpenseAccountId ?? category?.depreciationExpenseAccountId;
    if (!assetAccountId) throw new BadRequestException("Compte d'immobilisation manquant (ni fourni, ni hérité d'une catégorie).");
    await this.validatePostableAccount(companyId, assetAccountId);
    if (depreciationAccountId) await this.validatePostableAccount(companyId, depreciationAccountId);
    if (depreciationExpenseAccountId) await this.validatePostableAccount(companyId, depreciationExpenseAccountId);

    let invoice: any = null;
    if (dto.invoiceId) {
      invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
      if (!invoice || invoice.companyId !== companyId) throw new NotFoundException('Facture introuvable pour cette entreprise.');
      if (invoice.invoiceType !== 'PURCHASE') throw new BadRequestException("La facture liée à une immobilisation doit être une facture d'achat.");
    }

    const asset = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.fixedAsset.create({
        data: {
          companyId,
          code: dto.code,
          label: dto.label,
          categoryId: dto.categoryId,
          assetAccountId,
          depreciationAccountId,
          depreciationExpenseAccountId,
          supplierId: dto.supplierId,
          invoiceId: dto.invoiceId,
          acquisitionDate: new Date(dto.acquisitionDate),
          acquisitionCost: dto.acquisitionCost,
          residualValue: dto.residualValue ?? 0,
          usefulLifeYears: dto.usefulLifeYears,
          depreciationMethod: (dto.depreciationMethod ?? category?.defaultMethod ?? 'STRAIGHT_LINE') as any,
          status: 'ACQUIRED',
          location: dto.location,
          reference: dto.reference,
          notes: dto.notes,
        },
      });

      // Écriture d'acquisition directe — UNIQUEMENT si aucune facture
      // n'est liée : si une facture d'achat est liée, son écriture a
      // déjà été comptabilisée par le module invoices (Étape 10),
      // jamais de double comptabilisation ici.
      if (!dto.invoiceId) {
        if (!dto.counterpartAccountId) {
          throw new BadRequestException("Un compte de contrepartie est requis pour générer l'écriture d'acquisition (aucune facture liée).");
        }
        const entryId = await this.createBalancedEntry(tx, companyId, userId, {
          entryDate: new Date(dto.acquisitionDate),
          label: `Acquisition immobilisation ${dto.code}`,
          reference: dto.code,
          lines: [
            { accountId: assetAccountId, side: 'DEBIT', amount: dto.acquisitionCost, label: `Acquisition ${dto.label}` },
            { accountId: dto.counterpartAccountId, side: 'CREDIT', amount: dto.acquisitionCost, label: `Acquisition ${dto.label}` },
          ],
        });
        await tx.fixedAsset.update({ where: { id: created.id }, data: { acquisitionEntryId: entryId } });
      }

      return created;
    });

    await this.audit('CREATE', userId, companyId, 'FixedAsset', asset.id, null, { code: asset.code }, meta);
    return this.get(companyId, asset.id);
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateFixedAssetDto, meta: RequestMetadata) {
    const before = await this.getOrThrow(companyId, id);
    const updated = await this.prisma.fixedAsset.update({
      where: { id },
      data: { label: dto.label, location: dto.location, reference: dto.reference, notes: dto.notes },
    });
    await this.audit('UPDATE', userId, companyId, 'FixedAsset', id, { label: before.label }, { label: updated.label }, meta);
    return this.get(companyId, id);
  }

  /** Mise en service : ACQUIRED -> IN_SERVICE. Ancre le plan d'amortissement. */
  async putInService(companyId: string, id: string, userId: string, serviceDate: string, meta: RequestMetadata) {
    const asset = await this.getOrThrow(companyId, id);
    if (asset.status !== 'ACQUIRED') {
      throw new ConflictException(`Seule une immobilisation au statut ACQUIRED peut être mise en service (statut actuel: ${asset.status}) — double mise en service interdite.`);
    }
    const date = new Date(serviceDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date de mise en service.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" couvrant cette date n'est pas ouvert.`);

    await this.prisma.fixedAsset.update({ where: { id }, data: { status: 'IN_SERVICE', serviceDate: date } });
    await this.audit('UPDATE', userId, companyId, 'FixedAsset', id, { status: 'ACQUIRED' }, { status: 'IN_SERVICE' }, meta);
    return this.get(companyId, id);
  }

  /**
   * Génère la dotation aux amortissements d'un exercice donné.
   * L'index d'annuité est calculé comme (exercice_civil −
   * année_de_mise_en_service + 1), jamais utilisé directement comme
   * index du tableau — erreur corrigée en cours de route à l'Étape 12.
   */
  async generateDepreciation(companyId: string, id: string, userId: string, dto: GenerateDepreciationDto, meta: RequestMetadata) {
    const asset = await this.getOrThrow(companyId, id);
    if (asset.status !== 'IN_SERVICE') throw new ConflictException("Seule une immobilisation en service peut générer une dotation.");
    if (!asset.serviceDate) throw new ConflictException('Date de mise en service manquante.');
    if (!asset.depreciationAccountId || !asset.depreciationExpenseAccountId) {
      throw new BadRequestException("Comptes de dotation/amortissement manquants sur cette fiche.");
    }

    const periodDate = new Date(dto.periodDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: periodDate }, endDate: { gte: periodDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date de dotation.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" n'est pas ouvert.`);

    // Vérification applicative — message d'erreur clair, précède la
    // contrainte SQL unique qui reste le dernier recours sous
    // concurrence (deux dotations simultanées pour le même exercice).
    const existing = await this.prisma.depreciationEntry.findUnique({
      where: { fixedAssetId_fiscalYear: { fixedAssetId: id, fiscalYear: dto.fiscalYear } },
    });
    if (existing) throw new ConflictException(`Une dotation existe déjà pour l'exercice ${dto.fiscalYear} sur cette immobilisation.`);

    const schedule = computeDepreciationSchedule({
      acquisitionCost: Number(asset.acquisitionCost),
      residualValue: Number(asset.residualValue),
      usefulLifeYears: asset.usefulLifeYears,
      method: asset.depreciationMethod as any,
      serviceDate: asset.serviceDate,
    });
    const line = findScheduleLineForFiscalYear(schedule, dto.fiscalYear);
    if (!line) throw new BadRequestException(`L'exercice ${dto.fiscalYear} est hors du plan d'amortissement de cette immobilisation.`);

    const depreciationEntry = await this.prisma.$transaction(async (tx: any) => {
      const entryId = await this.createBalancedEntry(tx, companyId, userId, {
        entryDate: periodDate,
        label: `Dotation amortissement ${asset.code} — exercice ${dto.fiscalYear}`,
        reference: asset.code,
        lines: [
          { accountId: asset.depreciationExpenseAccountId!, side: 'DEBIT', amount: line.amount, label: `Dotation ${asset.label}` },
          { accountId: asset.depreciationAccountId!, side: 'CREDIT', amount: line.amount, label: `Dotation ${asset.label}` },
        ],
      });

      // Contrainte SQL unique (fixed_asset_id, fiscal_year) = dernier
      // recours atomique : si une dotation concurrente a été insérée
      // entre la vérification applicative et cet INSERT, PostgreSQL
      // rejette l'INSERT ici, pas de sur-dotation possible.
      const created = await tx.depreciationEntry.create({
        data: {
          fixedAssetId: id,
          companyId,
          fiscalYear: dto.fiscalYear,
          periodDate,
          amount: line.amount,
          accumulated: line.accumulated,
          netBookValue: line.netBookValue,
          linkedEntryId: entryId,
        },
      });

      // Si la dernière annuité du plan vient d'être générée, la fiche
      // passe automatiquement à FULLY_DEPRECIATED.
      if (line.period === schedule.length) {
        await tx.fixedAsset.update({ where: { id }, data: { status: 'FULLY_DEPRECIATED' } });
      }

      return created;
    });

    await this.audit('VALIDATE', userId, companyId, 'DepreciationEntry', depreciationEntry.id, null, { fiscalYear: dto.fiscalYear, amount: line.amount }, meta);
    return depreciationEntry;
  }

  /**
   * Cession/sortie d'immobilisation. Protection contre la double
   * cession : la contrainte SQL unique sur asset_disposals.fixed_asset_id
   * est le verrou de dernier recours, atomique sous concurrence — la
   * vérification applicative ci-dessous ne fait qu'offrir un message
   * d'erreur clair dans le cas non-concurrent.
   */
  async dispose(companyId: string, id: string, userId: string, dto: DisposeFixedAssetDto, meta: RequestMetadata) {
    const asset = await this.getOrThrow(companyId, id, { depreciationEntries: true });
    if (asset.status === 'DISPOSED') throw new ConflictException('Cette immobilisation a déjà été cédée.');
    if (asset.status === 'ACQUIRED') throw new ConflictException("Une immobilisation pas encore en service ne peut pas être cédée — utilisez sa suppression si la fiche a été créée par erreur.");

    const existingDisposal = await this.prisma.assetDisposal.findUnique({ where: { fixedAssetId: id } });
    if (existingDisposal) throw new ConflictException('Une cession existe déjà pour cette immobilisation.');

    if ((dto.disposalPrice ?? 0) > 0 && !dto.counterpartAccountId) {
      throw new BadRequestException('Un compte de contrepartie est requis lorsque le prix de cession est positif.');
    }

    const grossValue = Number(asset.acquisitionCost);
    const accumulatedDepreciation = asset.depreciationEntries.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const netBookValue = Math.round((grossValue - accumulatedDepreciation) * 100) / 100;
    const disposalPrice = dto.disposalPrice ?? 0;
    const result = Math.round((disposalPrice - netBookValue) * 100) / 100;

    const disposalDate = new Date(dto.disposalDate);
    const period = await this.prisma.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: disposalDate }, endDate: { gte: disposalDate } } });
    if (!period) throw new BadRequestException('Aucun exercice comptable ne couvre cette date de cession.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" n'est pas ouvert.`);

    const disposal = await this.prisma.$transaction(async (tx: any) => {
            const lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; label: string }> = [];
      if (accumulatedDepreciation > 0) {
        if (!asset.depreciationAccountId) {
          throw new BadRequestException(`Compte d'amortissement manquant sur la fiche ${asset.code} — impossible d'annuler les amortissements cumulés à la cession.`);
        }
        lines.push({ accountId: asset.depreciationAccountId, side: 'DEBIT', amount: accumulatedDepreciation, label: `Annulation amortissements ${asset.code}` });
      }
      if (disposalPrice > 0) {
        lines.push({ accountId: dto.counterpartAccountId!, side: 'DEBIT', amount: disposalPrice, label: `Produit de cession ${asset.code}` });
      }
      lines.push({ accountId: asset.assetAccountId, side: 'CREDIT', amount: grossValue, label: `Sortie immobilisation ${asset.code}` });
      if (result > 0) {
        lines.push({ accountId: dto.resultAccountId, side: 'CREDIT', amount: result, label: `Plus-value de cession ${asset.code}` });
      } else if (result < 0) {
        lines.push({ accountId: dto.resultAccountId, side: 'DEBIT', amount: -result, label: `Moins-value de cession ${asset.code}` });
      }

      const entryId = await this.createBalancedEntry(tx, companyId, userId, {
        entryDate: disposalDate,
        label: `Cession immobilisation ${asset.code}`,
        reference: asset.code,
        lines,
      });

      // Contrainte SQL unique sur fixed_asset_id = protection atomique
      // de dernier recours contre une double cession concurrente.
      const created = await tx.assetDisposal.create({
        data: {
          companyId,
          fixedAssetId: id,
          disposalDate,
          disposalType: dto.disposalType as any,
          grossValue,
          accumulatedDepreciation,
          netBookValue,
          disposalPrice,
          result,
          linkedEntryId: entryId,
          createdById: userId,
        },
      });

      await tx.fixedAsset.update({ where: { id }, data: { status: 'DISPOSED', disposalDate, disposalValue: disposalPrice } });

      return created;
    });

    await this.audit('VALIDATE', userId, companyId, 'AssetDisposal', disposal.id, null, { result }, meta);
    return disposal;
  }

  // =====================================================================
  // UTILITAIRES
  // =====================================================================

  /**
   * Crée une écriture DRAFT -> lignes -> VALIDATED dans un journal
   * GENERAL, en réutilisant EXACTEMENT le pattern de numérotation
   * atomique (fn_next_document_number) déjà utilisé par les Étapes
   * 7/10/11 — jamais de seconde logique de numérotation créée.
   */
  private async createBalancedEntry(
    tx: any,
    companyId: string,
    userId: string,
    input: { entryDate: Date; label: string; reference?: string; lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; label?: string }> },
  ): Promise<string> {
    const journal = await tx.journal.findFirst({ where: { companyId, type: 'GENERAL' as any, isActive: true }, orderBy: { code: 'asc' } });
    if (!journal) throw new BadRequestException("Aucun journal actif de type GENERAL configuré pour cette entreprise — créez-en un avant de générer une écriture d'immobilisation.");

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

    const created = await tx.accountingEntry.create({
      data: {
        companyId,
        periodId: (await tx.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: input.entryDate }, endDate: { gte: input.entryDate } } })).id,
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
          create: input.lines.map((l, i) => ({
            accountId: l.accountId,
            companyId,
            lineNumber: i + 1,
            side: l.side,
            amount: l.amount,
            label: l.label,
          })),
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
    const asset = await this.prisma.fixedAsset.findUnique({ where: { id }, include });
    if (!asset || asset.companyId !== companyId) throw new NotFoundException('Immobilisation introuvable pour cette entreprise.');
    return asset;
  }

  private async getCategoryOrThrow(companyId: string, id: string, include?: any) {
    const category = await this.prisma.assetCategory.findUnique({ where: { id }, include });
    if (!category || category.companyId !== companyId) throw new NotFoundException('Catégorie introuvable pour cette entreprise.');
    return category;
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
