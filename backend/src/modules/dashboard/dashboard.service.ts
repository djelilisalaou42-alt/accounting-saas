import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * =====================================================================
 * ÉTAPE 18 — Tableau de bord.
 *
 * Couche de PRÉSENTATION/AGRÉGATION uniquement — aucun nouveau moteur
 * de calcul comptable. Réutilise tel quel :
 *   - ReportsService.getIncomeStatement (Étape 15) -> CA/charges/résultat
 *   - ReportsService.getTreasuryReport  (Étape 15) -> caisse/banque
 *   - ReportsService.getTaxReport       (Étape 15) -> TVA (délègue déjà
 *     à TaxDeclarationsService, Étape 13)
 *   - ReportsService.getBudgetReport    (Étape 15) -> délègue déjà à
 *     BudgetsService.get() (réalisé recalculé depuis les écritures
 *     réelles, Étape 14)
 * Les seules requêtes réellement nouvelles ci-dessous (créances/dettes,
 * immobilisations, écritures en brouillon) n'existaient sous AUCUNE
 * forme exploitable ailleurs — plus petite couche nécessaire, comme
 * demandé, jamais un recalcul de ce qui existe déjà.
 *
 * Toute méthode prend companyId depuis le paramètre de route
 * (contrôlé par PermissionsGuard, jamais depuis le corps/la query) —
 * même garantie d'isolation que partout ailleurs dans ce projet.
 * =====================================================================
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
  ) {}

  async getDashboard(companyId: string, query: DashboardQueryDto) {
    // Le résultat de getIncomeStatement contient la période RÉSOLUE
    // (periodId -> dates, ou dates explicites, ou exercice OPEN par
    // défaut — logique déjà centralisée dans ReportsService) : on la
    // réutilise pour toutes les sections suivantes plutôt que de
    // dupliquer cette résolution.
    const income = await this.reportsService.getIncomeStatement(companyId, {
      periodId: query.periodId,
      startDate: query.startDate,
      endDate: query.endDate,
    });
    const { startDate, endDate } = income.period;
    const periodFilter = { startDate: startDate.toISOString(), endDate: endDate.toISOString() };

    const [treasury, taxes, budgetReport, receivablesPayables, fixedAssetsSummary, draftEntries, overdueInvoices] = await Promise.all([
      this.reportsService.getTreasuryReport(companyId, periodFilter),
      this.reportsService.getTaxReport(companyId, periodFilter),
      this.reportsService.getBudgetReport(companyId, { periodId: query.periodId }),
      this.getReceivablesAndPayables(companyId, endDate),
      this.getFixedAssetsSummary(companyId),
      this.countDraftEntries(companyId, startDate, endDate),
      this.getOverdueInvoices(companyId, endDate),
    ]);

            const budgetList: any[] = 'budgets' in budgetReport ? (budgetReport as any).budgets : [budgetReport];
    const budgetTotals = budgetList.reduce(
      (acc: any, b: any) => ({
        planned: round2(acc.planned + b.summary.totalPlanned),
        actual: round2(acc.actual + b.summary.totalActual),
      }),
      { planned: 0, actual: 0 },
    );
    const budgetVariance = round2(budgetTotals.actual - budgetTotals.planned);
    const budgetConsumptionRate = budgetTotals.planned !== 0 ? round2((budgetTotals.actual / budgetTotals.planned) * 100) : null;
    const summary = {
      revenue: income.totalRevenue,
      expenses: income.totalExpenses,
      profit: income.netResult,
      cashAvailable: round2(treasury.cash.balance + treasury.bank.balance),
    };

    const charts = await this.getMonthlyCharts(companyId, startDate, endDate);

    const alerts = this.computeAlerts({
      overdueInvoicesCount: overdueInvoices.count,
      payablesOverdueCount: receivablesPayables.payablesOverdueCount,
      taxRemaining: taxes.totals.remaining,
      budgetConsumptionRate,
      cashAvailable: summary.cashAvailable,
      draftEntriesCount: draftEntries,
      assetsAwaitingService: fixedAssetsSummary.acquiredNotInServiceCount,
    });

    return {
      period: { startDate, endDate },
      summary,
      cash: treasury,
      revenue: { total: income.totalRevenue, lines: income.revenueLines },
      expenses: { total: income.totalExpenses, lines: income.expenseLines },
      profit: income.netResult,
      receivables: receivablesPayables.receivables,
      payables: receivablesPayables.payables,
      taxes: taxes.totals,
            budget: { ...budgetTotals, variance: budgetVariance, consumptionRate: budgetConsumptionRate },
      fixedAssets: fixedAssetsSummary,
      draftEntriesCount: draftEntries,
      charts,
      alerts,
    };
  }

  /**
   * Créances clients / dettes fournisseurs — pas de méthode existante
   * exploitable ailleurs (le bilan, Étape 15, mélange classe 4 par
   * signe de solde sans distinguer client/fournisseur). Calculé
   * directement depuis Invoice.amountPaid (colonne déjà existante,
   * jamais un solde recalculé depuis les paiements en mémoire).
   */
  private async getReceivablesAndPayables(companyId: string, asOfDate: Date) {
    const rows: Array<{ invoice_type: string; count: string; total_outstanding: string; overdue_count: string }> = await this.prisma.$queryRaw`
      SELECT
        invoice_type,
        count(*)::text AS count,
        COALESCE(SUM(total - amount_paid), 0)::text AS total_outstanding,
        COALESCE(SUM(CASE WHEN due_date < ${asOfDate} THEN 1 ELSE 0 END), 0)::text AS overdue_count
      FROM invoices
      WHERE company_id = ${companyId}
        AND status NOT IN ('DRAFT', 'CANCELLED', 'PAID')
        AND (total - amount_paid) > 0
      GROUP BY invoice_type
    `;
    const sale = rows.find((r) => r.invoice_type === 'SALE');
    const purchase = rows.find((r) => r.invoice_type === 'PURCHASE');
    return {
      receivables: { total: sale ? round2(Number(sale.total_outstanding)) : 0, unpaidCount: sale ? Number(sale.count) : 0, overdueCount: sale ? Number(sale.overdue_count) : 0 },
      payables: { total: purchase ? round2(Number(purchase.total_outstanding)) : 0, unpaidCount: purchase ? Number(purchase.count) : 0, overdueCount: purchase ? Number(purchase.overdue_count) : 0 },
      payablesOverdueCount: purchase ? Number(purchase.overdue_count) : 0,
    };
  }

  /** Valeur brute / amortissements cumulés / VNC — agrégat inexistant ailleurs. */
  private async getFixedAssetsSummary(companyId: string) {
    const rows: Array<{ gross_value: string; accumulated_depreciation: string; acquired_count: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(fa.acquisition_cost), 0)::text AS gross_value,
        COALESCE((SELECT SUM(de.amount) FROM depreciation_entries de JOIN fixed_assets fa2 ON fa2.id = de.fixed_asset_id WHERE fa2.company_id = ${companyId} AND fa2.status <> 'DISPOSED'), 0)::text AS accumulated_depreciation,
        COALESCE(SUM(CASE WHEN fa.status = 'ACQUIRED' THEN 1 ELSE 0 END), 0)::text AS acquired_count
      FROM fixed_assets fa
      WHERE fa.company_id = ${companyId} AND fa.status <> 'DISPOSED'
    `;
    const grossValue = round2(Number(rows[0].gross_value));
    const accumulatedDepreciation = round2(Number(rows[0].accumulated_depreciation));
    return {
      grossValue,
      accumulatedDepreciation,
      netBookValue: round2(grossValue - accumulatedDepreciation),
      acquiredNotInServiceCount: Number(rows[0].acquired_count),
    };
  }

  private async countDraftEntries(companyId: string, startDate: Date, endDate: Date): Promise<number> {
    return this.prisma.accountingEntry.count({ where: { companyId, status: 'DRAFT', entryDate: { gte: startDate, lte: endDate } } });
  }

  private async getOverdueInvoices(companyId: string, asOfDate: Date): Promise<{ count: number }> {
    const count = await this.prisma.invoice.count({
      where: { companyId, invoiceType: 'SALE', status: { notIn: ['DRAFT', 'CANCELLED', 'PAID'] }, dueDate: { lt: asOfDate } },
    });
    return { count };
  }

  /** Évolution mensuelle CA/charges/résultat/trésorerie — même filtre `status <> 'DRAFT'` que partout ailleurs. */
  private async getMonthlyCharts(companyId: string, startDate: Date, endDate: Date) {
    const rows: Array<{ month: string; category: string; amount: string }> = await this.prisma.$queryRaw`
      SELECT to_char(date_trunc('month', e.entry_date), 'YYYY-MM') AS month, ac.category::text AS category,
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE -l.amount END), 0)::text AS amount
      FROM accounts a
      JOIN account_classes ac ON ac.id = a.account_class_id
      JOIN accounting_entry_lines l ON l.account_id = a.id AND l.company_id = a.company_id
      JOIN accounting_entries e ON e.id = l.entry_id AND e.status <> 'DRAFT'
      WHERE a.company_id = ${companyId} AND ac.category IN ('EXPENSE', 'REVENUE') AND e.entry_date BETWEEN ${startDate} AND ${endDate}
      GROUP BY 1, 2
      ORDER BY 1
    `;
    const months = new Map<string, { month: string; revenue: number; expenses: number }>();
    for (const r of rows) {
      const entry = months.get(r.month) ?? { month: r.month, revenue: 0, expenses: 0 };
      if (r.category === 'REVENUE') entry.revenue = round2(-Number(r.amount));
      else entry.expenses = round2(Number(r.amount));
      months.set(r.month, entry);
    }
    const revenueExpenses = [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ ...m, result: round2(m.revenue - m.expenses) }));

    const treasuryRows: Array<{ month: string; cash_delta: string; bank_delta: string }> = await this.prisma.$queryRaw`
      SELECT to_char(date_trunc('month', combined.d), 'YYYY-MM') AS month,
        COALESCE(SUM(combined.cash_delta), 0)::text AS cash_delta,
        COALESCE(SUM(combined.bank_delta), 0)::text AS bank_delta
      FROM (
        SELECT transaction_date AS d, CASE WHEN type = 'RECEIPT' THEN amount ELSE -amount END AS cash_delta, 0 AS bank_delta
        FROM cash_transactions WHERE company_id = ${companyId} AND transaction_date BETWEEN ${startDate} AND ${endDate}
        UNION ALL
        SELECT transaction_date AS d, 0 AS cash_delta, CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END AS bank_delta
        FROM bank_transactions WHERE company_id = ${companyId} AND transaction_date BETWEEN ${startDate} AND ${endDate}
      ) combined
      GROUP BY 1
      ORDER BY 1
    `;
    const treasuryEvolution = treasuryRows.map((r) => ({ month: r.month, delta: round2(Number(r.cash_delta) + Number(r.bank_delta)) }));

    return { revenueExpenses, treasuryEvolution };
  }

  /**
   * Alertes calculées à partir de données réelles uniquement. Seuils
   * EXPLICITES et documentés ici (pas de configuration en base pour
   * cette étape — hors périmètre) :
   *   - taux de consommation budgétaire : "à surveiller" >= 90 %,
   *     "dépassé" > 100 % — convention usuelle de contrôle de gestion ;
   *   - trésorerie disponible < 0 : toujours signalé (seuil non
   *     arbitraire : un solde négatif est un fait, pas une convention) ;
   *   - toute autre alerte (factures échues, dettes échues, TVA restant
   *     due, écritures en brouillon, immobilisations pas en service)
   *     est signalée dès que le compte correspondant est > 0 — aucun
   *     seuil numérique arbitraire au-delà de zéro.
   */
  private computeAlerts(data: {
    overdueInvoicesCount: number;
    payablesOverdueCount: number;
    taxRemaining: number;
    budgetConsumptionRate: number | null;
    cashAvailable: number;
    draftEntriesCount: number;
    assetsAwaitingService: number;
  }): Array<{ level: 'info' | 'warning' | 'critical'; message: string }> {
    const alerts: Array<{ level: 'info' | 'warning' | 'critical'; message: string }> = [];

    if (data.overdueInvoicesCount > 0) {
      alerts.push({ level: 'warning', message: `${data.overdueInvoicesCount} facture(s) client échue(s) non réglée(s).` });
    }
    if (data.payablesOverdueCount > 0) {
      alerts.push({ level: 'warning', message: `${data.payablesOverdueCount} facture(s) fournisseur échue(s) non réglée(s).` });
    }
    if (data.taxRemaining > 0) {
      alerts.push({ level: 'warning', message: `TVA restant à payer : ${data.taxRemaining}.` });
    }
    if (data.budgetConsumptionRate !== null && data.budgetConsumptionRate > 100) {
      alerts.push({ level: 'critical', message: `Budget dépassé (${data.budgetConsumptionRate}% consommé).` });
    } else if (data.budgetConsumptionRate !== null && data.budgetConsumptionRate >= 90) {
      alerts.push({ level: 'warning', message: `Budget fortement consommé (${data.budgetConsumptionRate}%).` });
    }
    if (data.cashAvailable < 0) {
      alerts.push({ level: 'critical', message: `Trésorerie disponible négative (${data.cashAvailable}).` });
    }
    if (data.draftEntriesCount > 0) {
      alerts.push({ level: 'info', message: `${data.draftEntriesCount} écriture(s) en brouillon sur la période.` });
    }
    if (data.assetsAwaitingService > 0) {
      alerts.push({ level: 'info', message: `${data.assetsAwaitingService} immobilisation(s) acquise(s) pas encore mise(s) en service.` });
    }
    return alerts;
  }
}
