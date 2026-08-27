import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBudgetDto, CreateBudgetLineDto, ListBudgetsDto, UpdateBudgetDto, UpdateBudgetLineDto } from './dto/budget.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * =====================================================================
 * ÉTAPE 14 — Budgets et contrôle de gestion.
 *
 * Finalisation pré-production : décision sur les exercices clôturés
 * (absente du code initial de l'Étape 14, signalée par l'audit
 * pré-production). Un budget représente un engagement de planification
 * pour un exercice entier (`periodId`) — même principe que toute
 * opération liée à une période dans ce projet (factures, trésorerie,
 * immobilisations, déclarations fiscales) : `period.status !== 'OPEN'`
 * -> `ForbiddenException`, message identique
 * (`"L'exercice ... n'est pas ouvert."`). Créer ou modifier un NOUVEAU
 * plan budgétaire pour un exercice définitivement clos n'a pas de sens
 * (contrairement à une facture, qui enregistre un fait passé, un
 * budget engage l'avenir). Règle appliquée à `create`, `createLine`,
 * `updateLine`, `update` — mais PAS à `close()` : clôturer un budget
 * déjà actif est un geste administratif de rangement, jamais un
 * nouvel engagement, et l'interdire laisserait des budgets ACTIVE
 * définitivement non-clôturables une fois leur exercice terminé.
 * La consultation (`get`/`list`) reste toujours possible après
 * clôture, comme pour tous les autres modules du projet.
 *
 * `BudgetLine.actualAmount` (colonne existante, schéma initial) N'EST
 * JAMAIS la source de vérité — même règle que CashAccount.currentBalance
 * (Étape 11) : le réalisé est TOUJOURS recalculé depuis les lignes
 * d'écriture VALIDÉES du compte, pour le mois et l'exercice du budget,
 * avec la MÊME convention que le Grand Livre (Étape 8) : montant =
 * débit − crédit. Jamais de donnée saisie manuellement.
 *
 * Pas de centre analytique : aucune architecture correspondante
 * n'existe dans le projet — une ligne budgétaire reste strictement
 * (compte, mois), comme le prévoyait déjà le schéma initial.
 * =====================================================================
 */
@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, filters: ListBudgetsDto) {
    const where: any = { companyId };
    if (filters.periodId) where.periodId = filters.periodId;
    if (filters.status) where.status = filters.status;
    return this.prisma.budget.findMany({
      where,
      include: { period: { select: { name: true, startDate: true, endDate: true } }, lines: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const budget = await this.getOrThrow(companyId, id, {
      period: true,
      lines: { include: { account: { select: { code: true, label: true } } }, orderBy: [{ accountId: 'asc' }, { month: 'asc' }] },
    });
    const actuals = await this.computeActuals(companyId, budget.periodId, budget.lines.map((l: any) => ({ accountId: l.accountId, month: l.month })));
    const lines = budget.lines.map((l: any) => {
      const key = `${l.accountId}:${l.month}`;
      const actualAmount = actuals.get(key) ?? 0;
      const plannedAmount = Number(l.plannedAmount);
      const variance = round2(actualAmount - plannedAmount);
      const consumptionRate = plannedAmount !== 0 ? round2((actualAmount / plannedAmount) * 100) : null;
      return { ...l, actualAmount, plannedAmount, variance, consumptionRate };
    });
    const totals = lines.reduce(
      (acc: any, l: any) => ({ planned: round2(acc.planned + l.plannedAmount), actual: round2(acc.actual + l.actualAmount) }),
      { planned: 0, actual: 0 },
    );
    return {
      ...budget,
      lines,
      summary: {
        totalPlanned: totals.planned,
        totalActual: totals.actual,
        totalVariance: round2(totals.actual - totals.planned),
        consumptionRate: totals.planned !== 0 ? round2((totals.actual / totals.planned) * 100) : null,
      },
    };
  }

  async create(companyId: string, userId: string, dto: CreateBudgetDto, meta: RequestMetadata) {
    const period = await this.prisma.accountingPeriod.findUnique({ where: { id: dto.periodId } });
    if (!period || period.companyId !== companyId) throw new NotFoundException('Exercice comptable introuvable pour cette entreprise.');
    if (period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${period.name}" n'est pas ouvert.`);

    // Vérification applicative — précède la contrainte SQL unique
    // (companyId, periodId, name), dernier recours atomique sous
    // concurrence (même principe qu'aux Étapes 12/13).
    const existing = await this.prisma.budget.findUnique({ where: { companyId_periodId_name: { companyId, periodId: dto.periodId, name: dto.name } } });
    if (existing) throw new ConflictException(`Un budget nommé "${dto.name}" existe déjà pour cet exercice.`);

    const budget = await this.prisma.budget.create({
      data: { companyId, periodId: dto.periodId, name: dto.name, description: dto.description, status: 'DRAFT', createdById: userId },
    });
    await this.audit('CREATE', userId, companyId, 'Budget', budget.id, null, { name: budget.name }, meta);
    return this.get(companyId, budget.id);
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateBudgetDto, meta: RequestMetadata) {
    const budget = await this.getOrThrow(companyId, id, { period: true });
    if (budget.status !== 'DRAFT') throw new ConflictException('Seul un budget en brouillon peut être modifié.');
    if ((budget as any).period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${(budget as any).period.name}" n'est pas ouvert.`);
    const updated = await this.prisma.budget.update({ where: { id }, data: { name: dto.name, description: dto.description } });
    await this.audit('UPDATE', userId, companyId, 'Budget', id, { name: budget.name }, { name: updated.name }, meta);
    return this.get(companyId, id);
  }

  /** DRAFT -> ACTIVE : verrouille les lignes, le budget devient suivi. */
  async activate(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const budget = await this.getOrThrow(companyId, id, { period: true });
    if (budget.status !== 'DRAFT') throw new ConflictException('Seul un budget en brouillon peut être activé.');
    if ((budget as any).period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${(budget as any).period.name}" n'est pas ouvert.`);
    await this.prisma.budget.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit('VALIDATE', userId, companyId, 'Budget', id, { status: 'DRAFT' }, { status: 'ACTIVE' }, meta);
    return this.get(companyId, id);
  }

  /**
   * ACTIVE -> CLOSED : clôture définitive du suivi budgétaire.
   * Volontairement PERMISE même si l'exercice comptable est déjà
   * clôturé — un geste administratif de rangement, jamais un nouvel
   * engagement financier, voir la note d'architecture en tête de
   * fichier. Sans cette exception, un budget ACTIVE deviendrait
   * définitivement non-clôturable dès que son exercice se termine.
   */
  async close(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const budget = await this.getOrThrow(companyId, id);
    if (budget.status !== 'ACTIVE') throw new ConflictException('Seul un budget actif peut être clôturé.');
    await this.prisma.budget.update({ where: { id }, data: { status: 'CLOSED' } });
    await this.audit('UPDATE', userId, companyId, 'Budget', id, { status: 'ACTIVE' }, { status: 'CLOSED' }, meta);
    return this.get(companyId, id);
  }

  // =====================================================================
  // LIGNES BUDGÉTAIRES
  // =====================================================================

  async createLine(companyId: string, budgetId: string, userId: string, dto: CreateBudgetLineDto, meta: RequestMetadata) {
    const budget = await this.getOrThrow(companyId, budgetId, { period: true });
    if (budget.status !== 'DRAFT') throw new ConflictException('Les lignes ne peuvent être ajoutées que sur un budget en brouillon.');
    if ((budget as any).period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${(budget as any).period.name}" n'est pas ouvert.`);
    await this.validatePostableAccount(companyId, dto.accountId);

    const existing = await this.prisma.budgetLine.findUnique({ where: { budgetId_accountId_month: { budgetId, accountId: dto.accountId, month: dto.month } } });
    if (existing) throw new ConflictException('Une ligne existe déjà pour ce compte et ce mois dans ce budget.');

    const line = await this.prisma.budgetLine.create({ data: { budgetId, companyId, accountId: dto.accountId, month: dto.month, plannedAmount: dto.plannedAmount } });
    await this.audit('CREATE', userId, companyId, 'BudgetLine', line.id, null, { accountId: dto.accountId, month: dto.month }, meta);
    return line;
  }

  async updateLine(companyId: string, budgetId: string, lineId: string, userId: string, dto: UpdateBudgetLineDto, meta: RequestMetadata) {
    const budget = await this.getOrThrow(companyId, budgetId, { period: true });
    if (budget.status !== 'DRAFT') throw new ConflictException('Les lignes ne peuvent être modifiées que sur un budget en brouillon.');
    if ((budget as any).period.status !== 'OPEN') throw new ForbiddenException(`L'exercice "${(budget as any).period.name}" n'est pas ouvert.`);
    const line = await this.prisma.budgetLine.findUnique({ where: { id: lineId } });
    if (!line || line.budgetId !== budgetId || line.companyId !== companyId) throw new NotFoundException('Ligne budgétaire introuvable.');

    const updated = await this.prisma.budgetLine.update({ where: { id: lineId }, data: { plannedAmount: dto.plannedAmount } });
    await this.audit('UPDATE', userId, companyId, 'BudgetLine', lineId, { plannedAmount: line.plannedAmount }, { plannedAmount: dto.plannedAmount }, meta);
    return updated;
  }

  // =====================================================================
  // RÉALISÉ — calculé depuis les vraies écritures, jamais saisi
  // =====================================================================

  /**
   * Pour un ensemble de (accountId, month), calcule le mouvement réel
   * (débit − crédit, même convention que le Grand Livre) sur le mois
   * civil correspondant DANS l'exercice du budget, en une seule requête
   * agrégée SQL — jamais de boucle applicative par ligne.
   */
  private async computeActuals(companyId: string, periodId: string, cells: Array<{ accountId: string; month: number }>): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (cells.length === 0) return result;

    const period = await this.prisma.accountingPeriod.findUnique({ where: { id: periodId } });
    if (!period) return result;

    const accountIds = [...new Set(cells.map((c) => c.accountId))];
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT l.account_id, EXTRACT(MONTH FROM e.entry_date)::int AS month,
              COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
              COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
       FROM accounting_entry_lines l
       JOIN accounting_entries e ON e.id = l.entry_id
       WHERE l.company_id = $1 AND l.account_id = ANY($2::text[]) AND e.status <> 'DRAFT'
         AND e.entry_date BETWEEN $3 AND $4
       GROUP BY l.account_id, EXTRACT(MONTH FROM e.entry_date)`,
      companyId,
      accountIds,
      period.startDate,
      period.endDate,
    )) as Array<{ account_id: string; month: number; debit: string; credit: string }>;

    for (const r of rows) {
      const key = `${r.account_id}:${r.month}`;
      result.set(key, round2(Number(r.debit) - Number(r.credit)));
    }
    return result;
  }

  // =====================================================================
  // UTILITAIRES
  // =====================================================================

  private async validatePostableAccount(companyId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== companyId) throw new NotFoundException('Compte comptable introuvable pour cette entreprise.');
    if (!account.isActive) throw new BadRequestException(`Le compte ${account.code} est désactivé.`);
    if (!account.isPostable) throw new BadRequestException(`Le compte ${account.code} est un compte de regroupement (non mouvementable).`);
  }

  private async getOrThrow(companyId: string, id: string, include?: any) {
    const budget = await this.prisma.budget.findUnique({ where: { id }, include });
    if (!budget || budget.companyId !== companyId) throw new NotFoundException('Budget introuvable pour cette entreprise.');
    return budget;
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
