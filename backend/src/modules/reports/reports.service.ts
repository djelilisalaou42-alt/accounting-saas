import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { JournalReportQueryDto } from './dto/journal-report-query.dto';
import { BudgetReportQueryDto, ComparativeReportQueryDto, DateRangeReportQueryDto, TaxReportQueryDto } from './dto/analysis-report-query.dto';
import { BudgetsService } from '../budgets/budgets.service';
import { TaxDeclarationsService } from '../tax-declarations/tax-declarations.service';
import { CashService } from '../cash/cash.service';
import { BankService } from '../bank/bank.service';

/**
 * =====================================================================
 * RÈGLE COMPTABLE CENTRALE (Étape 8, §2) — documentée ici car elle
 * conditionne TOUTES les requêtes de ce service :
 *
 * Les rapports incluent les écritures de statut VALIDATED **et**
 * REVERSED — jamais DRAFT. Une écriture contrepassée (REVERSED) reste
 * un mouvement réellement comptabilisé historiquement : sa
 * contrepassation est une AUTRE écriture (VALIDATED) qui vient
 * annuler son effet, mais ne supprime jamais le mouvement d'origine
 * des rapports. Exclure les écritures REVERSED romprait l'égalité
 * fondamentale « total débit = total crédit » sur l'ensemble de la
 * comptabilité (la contrepassation, elle, resterait visible, mais pas
 * l'écriture qu'elle annule — un déséquilibre artificiel).
 *
 * En clair : `status <> 'DRAFT'` est le filtre utilisé partout dans ce
 * service, jamais `status = 'VALIDATED'` seul.
 * =====================================================================
 *
 * CONVENTION DE SIGNE (Étape 8, §5) : le modèle `AccountingEntryLine`
 * (Étape 2/3) ne porte pas de notion de « sens naturel » par compte
 * (un compte de classe 4 peut légitimement être tantôt débiteur,
 * tantôt créditeur selon les mouvements). Ce service adopte donc la
 * convention universelle : solde = total_débit − total_crédit.
 *   - solde >= 0  -> affiché en « solde débiteur »
 *   - solde < 0   -> affiché en « solde créditeur » (valeur absolue)
 * Appliquée identiquement dans le Grand Livre et la Balance.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetsService: BudgetsService,
    private readonly taxDeclarationsService: TaxDeclarationsService,
    private readonly cashService: CashService,
    private readonly bankService: BankService,
  ) {}

  // =====================================================================
  // GRAND LIVRE — consultation d'un compte
  // =====================================================================

  async getAccountLedger(companyId: string, accountId: string, query: GeneralLedgerQueryDto) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { accountClass: true },
    });
    if (!account || account.companyId !== companyId) {
      // Même logique que dans les autres modules (Étapes 5-7) : un
      // compte d'une autre entreprise est traité comme inexistant.
      throw new NotFoundException('Compte introuvable pour cette entreprise.');
    }

    const { startDate, endDate } = await this.resolveDateRange(companyId, query.periodId, query.startDate, query.endDate);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;

    // Solde initial : tous les mouvements de ce compte strictement
    // AVANT la date de début, jamais depuis des écritures DRAFT.
    const openingRows: Array<{ debit: string; credit: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}
        AND l.account_id = ${accountId}
        AND e.status <> 'DRAFT'
        AND e.entry_date < ${startDate}
    `;
    const openingDebit = Number(openingRows[0].debit);
    const openingCredit = Number(openingRows[0].credit);
    const openingBalance = openingDebit - openingCredit;

    // Filtres optionnels (journal, recherche) appliqués en plus des
    // filtres d'autorité obligatoires (company_id, account_id, statut,
    // période) — jamais en remplacement.
    const journalFilter = query.journalId ?? null;
    const searchFilter = query.search ? `%${query.search}%` : null;

    const countRows: Array<{ count: string }> = await this.prisma.$queryRaw`
      SELECT COUNT(*)::text AS count
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}
        AND l.account_id = ${accountId}
        AND e.status <> 'DRAFT'
        AND e.entry_date BETWEEN ${startDate} AND ${endDate}
        AND (${journalFilter}::text IS NULL OR e.journal_id = ${journalFilter})
        AND (${searchFilter}::text IS NULL OR e.entry_number ILIKE ${searchFilter} OR e.label ILIKE ${searchFilter})
    `;
    const total = Number(countRows[0].count);

    // Solde progressif calculé par une fonction fenêtrée PostgreSQL
    // (SUM() OVER (ORDER BY ...)) — le calcul porte sur l'ENSEMBLE des
    // lignes filtrées avant application de LIMIT/OFFSET, donc la
    // pagination n'introduit aucune erreur de solde progressif.
    const movements: Array<{
      entry_date: Date;
      entry_number: string;
      entry_label: string;
      line_label: string | null;
      side: 'DEBIT' | 'CREDIT';
      amount: string;
      journal_code: string;
      journal_label: string;
      lettering_code: string | null;
      running_delta: string;
    }> = await this.prisma.$queryRaw`
      SELECT * FROM (
        SELECT
          e.entry_date,
          e.entry_number,
          e.label AS entry_label,
          l.label AS line_label,
          l.side,
          l.amount::text AS amount,
          j.code AS journal_code,
          j.label AS journal_label,
          lt.code AS lettering_code,
          SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE -l.amount END)
            OVER (ORDER BY e.entry_date, e.entry_number, l.line_number
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text AS running_delta
        FROM accounting_entry_lines l
        JOIN accounting_entries e ON e.id = l.entry_id
        JOIN journals j ON j.id = e.journal_id
        LEFT JOIN letterings lt ON lt.id = l.lettering_id
        WHERE l.company_id = ${companyId}
          AND l.account_id = ${accountId}
          AND e.status <> 'DRAFT'
          AND e.entry_date BETWEEN ${startDate} AND ${endDate}
          AND (${journalFilter}::text IS NULL OR e.journal_id = ${journalFilter})
          AND (${searchFilter}::text IS NULL OR e.entry_number ILIKE ${searchFilter} OR e.label ILIKE ${searchFilter})
        ORDER BY e.entry_date, e.entry_number, l.line_number
      ) sub
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const rows = movements.map((m) => ({
      entryDate: m.entry_date,
      entryNumber: m.entry_number,
      entryLabel: m.entry_label,
      lineLabel: m.line_label,
      journal: { code: m.journal_code, label: m.journal_label },
      debit: m.side === 'DEBIT' ? Number(m.amount) : 0,
      credit: m.side === 'CREDIT' ? Number(m.amount) : 0,
      balance: openingBalance + Number(m.running_delta),
      // Étape 9 — code de lettrage (null si la ligne n'est pas lettrée).
      // Champ purement additif : ne modifie ni le calcul du solde
      // progressif ni aucune règle existante de l'Étape 8.
      letteringCode: m.lettering_code,
    }));

    const periodDebit = rows.reduce((sum, r) => sum + r.debit, 0);
    const periodCredit = rows.reduce((sum, r) => sum + r.credit, 0);
    // NOTE : périodDebit/périodCredit ci-dessus ne portent que sur la
    // PAGE courante — voir `totals` plus bas pour les totaux réels sur
    // l'ensemble de la période filtrée (calculés séparément par
    // agrégation SQL, jamais en sommant les pages en mémoire).
    void periodDebit;
    void periodCredit;

    const totalsRows: Array<{ debit: string; credit: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}
        AND l.account_id = ${accountId}
        AND e.status <> 'DRAFT'
        AND e.entry_date BETWEEN ${startDate} AND ${endDate}
        AND (${journalFilter}::text IS NULL OR e.journal_id = ${journalFilter})
        AND (${searchFilter}::text IS NULL OR e.entry_number ILIKE ${searchFilter} OR e.label ILIKE ${searchFilter})
    `;
    const totalDebit = Number(totalsRows[0].debit);
    const totalCredit = Number(totalsRows[0].credit);
    const closingBalance = openingBalance + totalDebit - totalCredit;

    return {
      account: {
        id: account.id,
        code: account.code,
        label: account.label,
        classCode: account.accountClass.code,
        level: account.level,
        isPostable: account.isPostable,
        isActive: account.isActive,
      },
      period: { startDate, endDate },
      openingBalance: this.signedBalance(openingBalance),
      movements: rows,
      totals: { totalDebit, totalCredit },
      closingBalance: this.signedBalance(closingBalance),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // =====================================================================
  // BALANCE GÉNÉRALE
  // =====================================================================

  async getTrialBalance(companyId: string, query: TrialBalanceQueryDto) {
    const { startDate, endDate } = await this.resolveDateRange(companyId, query.periodId, query.startDate, query.endDate);

    const classFilter = query.classCode ?? null;
    const searchFilter = query.search ? `%${query.search}%` : null;

    // Une seule requête agrégée (SUM + GROUP BY côté PostgreSQL,
    // jamais en mémoire) : mouvements de la période sélectionnée
    // (colonnes Débit/Crédit) ET solde cumulé depuis l'origine jusqu'à
    // la fin de période (colonnes Solde débiteur/créditeur) — voir la
    // distinction documentée dans le README, section Étape 8.
    const rows: Array<{
      id: string;
      code: string;
      label: string;
      class_code: string;
      period_debit: string;
      period_credit: string;
      cumulative_debit: string;
      cumulative_credit: string;
    }> = await this.prisma.$queryRaw`
      SELECT
        a.id, a.code, a.label, ac.code AS class_code,
        COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ${startDate} AND ${endDate} AND l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS period_debit,
        COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ${startDate} AND ${endDate} AND l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS period_credit,
        COALESCE(SUM(CASE WHEN e.entry_date <= ${endDate} AND l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS cumulative_debit,
        COALESCE(SUM(CASE WHEN e.entry_date <= ${endDate} AND l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS cumulative_credit
      FROM accounts a
      JOIN account_classes ac ON ac.id = a.account_class_id
      LEFT JOIN accounting_entry_lines l ON l.account_id = a.id AND l.company_id = a.company_id
      LEFT JOIN accounting_entries e ON e.id = l.entry_id AND e.status <> 'DRAFT'
      WHERE a.company_id = ${companyId}
        AND (${classFilter}::text IS NULL OR ac.code = ${classFilter})
        AND (${searchFilter}::text IS NULL OR a.code ILIKE ${searchFilter} OR a.label ILIKE ${searchFilter})
      GROUP BY a.id, a.code, a.label, ac.code
      HAVING
        COALESCE(SUM(CASE WHEN e.entry_date <= ${endDate} THEN 1 ELSE 0 END), 0) > 0
      ORDER BY a.code
    `;

    const lines = rows.map((r) => {
      const cumDebit = Number(r.cumulative_debit);
      const cumCredit = Number(r.cumulative_credit);
      const balance = cumDebit - cumCredit;
      return {
        accountId: r.id,
        code: r.code,
        label: r.label,
        classCode: r.class_code,
        periodDebit: Number(r.period_debit),
        periodCredit: Number(r.period_credit),
        debitBalance: balance >= 0 ? balance : 0,
        creditBalance: balance < 0 ? -balance : 0,
      };
    });

    const totals = lines.reduce(
      (acc, l) => ({
        totalPeriodDebit: acc.totalPeriodDebit + l.periodDebit,
        totalPeriodCredit: acc.totalPeriodCredit + l.periodCredit,
        totalDebitBalance: acc.totalDebitBalance + l.debitBalance,
        totalCreditBalance: acc.totalCreditBalance + l.creditBalance,
      }),
      { totalPeriodDebit: 0, totalPeriodCredit: 0, totalDebitBalance: 0, totalCreditBalance: 0 },
    );

    // Contrôle d'intégrité explicite — jamais masqué (§11). Un écart ne
    // devrait jamais se produire (garanti par les triggers de l'Étape
    // 3), mais ce contrôle reste affiché pour audit, pas seulement en
    // cas d'anomalie.
    const periodBalanced = Math.round((totals.totalPeriodDebit - totals.totalPeriodCredit) * 100) === 0;
    const cumulativeBalanced = Math.round((totals.totalDebitBalance - totals.totalCreditBalance) * 100) === 0;

    return {
      period: { startDate, endDate },
      lines,
      totals,
      integrity: {
        periodBalanced,
        cumulativeBalanced,
        periodGap: Math.round((totals.totalPeriodDebit - totals.totalPeriodCredit) * 100) / 100,
        cumulativeGap: Math.round((totals.totalDebitBalance - totals.totalCreditBalance) * 100) / 100,
      },
    };
  }

  // =====================================================================
  // EXPORT CSV — mêmes filtres, mêmes règles, aucune donnée d'une autre
  // entreprise ; jamais de log du contenu généré.
  // =====================================================================

  async exportAccountLedgerCsv(companyId: string, accountId: string, query: GeneralLedgerQueryDto): Promise<string> {
    // Réutilise EXACTEMENT la même méthode que l'affichage — mêmes
    // filtres, mêmes règles comptables, aucune divergence possible
    // entre ce que l'utilisateur voit et ce qu'il exporte. On retire
    // simplement la pagination pour l'export complet.
    const fullQuery = { ...query, page: 1, pageSize: 100000 };
    const ledger = await this.getAccountLedger(companyId, accountId, fullQuery);

    const header = ['Date', 'Journal', 'N° écriture', 'Libellé', 'Débit', 'Crédit', 'Solde'];
    const rows = ledger.movements.map((m) => [
      m.entryDate.toISOString().slice(0, 10),
      m.journal.code,
      m.entryNumber,
      m.lineLabel ?? m.entryLabel,
      m.debit.toFixed(2),
      m.credit.toFixed(2),
      m.balance.toFixed(2),
    ]);

    return this.toCsv([header, ...rows]);
  }

  async exportTrialBalanceCsv(companyId: string, query: TrialBalanceQueryDto): Promise<string> {
    const balance = await this.getTrialBalance(companyId, query);
    const header = ['Code', 'Compte', 'Classe', 'Débit période', 'Crédit période', 'Solde débiteur', 'Solde créditeur'];
    const rows = balance.lines.map((l) => [
      l.code,
      l.label,
      l.classCode,
      l.periodDebit.toFixed(2),
      l.periodCredit.toFixed(2),
      l.debitBalance.toFixed(2),
      l.creditBalance.toFixed(2),
    ]);
    return this.toCsv([header, ...rows]);
  }

  // =====================================================================
  // JOURNAL COMPTABLE — Étape 15. Consultation multi-comptes/multi-
  // journaux, contrairement au Grand Livre (Étape 8) qui exige un seul
  // compte. Réutilise le même filtre de statut « non-DRAFT par défaut »
  // mais permet ici de choisir explicitement un statut (utile pour
  // retrouver des brouillons non encore validés, chose que le Grand
  // Livre/la Balance excluent volontairement).
  // =====================================================================

  async getJournalReport(companyId: string, query: JournalReportQueryDto) {
    const { startDate, endDate } = await this.resolveDateRange(companyId, query.periodId, query.startDate, query.endDate);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;

    const where: any = {
      companyId,
      entryDate: { gte: startDate, lte: endDate },
      status: query.status ?? { not: 'DRAFT' },
    };
    if (query.journalId) where.journalId = query.journalId;
    if (query.accountId) where.lines = { some: { accountId: query.accountId } };

    const [total, entries] = await Promise.all([
      this.prisma.accountingEntry.count({ where }),
      this.prisma.accountingEntry.findMany({
        where,
        include: {
          journal: { select: { code: true, label: true } },
          lines: {
            where: query.accountId ? { accountId: query.accountId } : undefined,
            include: { account: { select: { code: true, label: true } } },
            orderBy: { lineNumber: 'asc' },
          },
        },
        orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      period: { startDate, endDate },
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      entries: entries.map((e: any) => ({
        id: e.id,
        entryDate: e.entryDate,
        entryNumber: e.entryNumber,
        label: e.label,
        status: e.status,
        journal: e.journal,
        lines: e.lines.map((l: any) => ({
          account: l.account,
          label: l.label,
          side: l.side,
          amount: Number(l.amount),
        })),
      })),
    };
  }

  // =====================================================================
  // COMPTE DE RÉSULTAT — Étape 15. Charges/produits regroupés par
  // AccountClass.category (EXPENSE/REVENUE, Étape 6) — jamais par
  // numéro de classe codé en dur, jamais de charge/produit saisi
  // manuellement : uniquement les écritures VALIDATED/REVERSED réelles
  // (même filtre `status <> 'DRAFT'` que partout ailleurs dans ce
  // service).
  // =====================================================================

  async getIncomeStatement(companyId: string, query: ComparativeReportQueryDto) {
    const { startDate, endDate } = await this.resolveDateRange(companyId, query.periodId, query.startDate, query.endDate);
    const current = await this.computeIncomeStatementFigures(companyId, startDate, endDate);

    let comparison = null;
    if (query.comparePeriodId) {
      const comparePeriod = await this.prisma.accountingPeriod.findUnique({ where: { id: query.comparePeriodId } });
      if (!comparePeriod || comparePeriod.companyId !== companyId) throw new NotFoundException('Exercice de comparaison introuvable pour cette entreprise.');
      comparison = { period: { startDate: comparePeriod.startDate, endDate: comparePeriod.endDate }, ...(await this.computeIncomeStatementFigures(companyId, comparePeriod.startDate, comparePeriod.endDate)) };
    }

    return { period: { startDate, endDate }, ...current, comparison };
  }

  private async computeIncomeStatementFigures(companyId: string, startDate: Date, endDate: Date) {
    const rows: Array<{ category: string; class_code: string; code: string; label: string; amount: string }> = await this.prisma.$queryRaw`
      SELECT ac.category::text as category, ac.code as class_code, a.code, a.label,
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE -l.amount END), 0)::text AS amount
      FROM accounts a
      JOIN account_classes ac ON ac.id = a.account_class_id
      JOIN accounting_entry_lines l ON l.account_id = a.id AND l.company_id = a.company_id
      JOIN accounting_entries e ON e.id = l.entry_id AND e.status <> 'DRAFT'
      WHERE a.company_id = ${companyId}
        AND ac.category IN ('EXPENSE', 'REVENUE')
        AND e.entry_date BETWEEN ${startDate} AND ${endDate}
      GROUP BY ac.category, ac.code, a.code, a.label
      ORDER BY ac.category, a.code
    `;

    const expenseLines = rows.filter((r) => r.category === 'EXPENSE').map((r) => ({ code: r.code, label: r.label, amount: Number(r.amount) }));
    const revenueLines = rows.filter((r) => r.category === 'REVENUE').map((r) => ({ code: r.code, label: r.label, amount: -Number(r.amount) })); // produits : solde naturellement créditeur

    const totalExpenses = Math.round(expenseLines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const totalRevenue = Math.round(revenueLines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const netResult = Math.round((totalRevenue - totalExpenses) * 100) / 100;

    return { expenseLines, revenueLines, totalExpenses, totalRevenue, netResult };
  }

  // =====================================================================
  // BILAN — Étape 15. Classement par AccountClass.category (Étape 6) :
  // ASSET (classes 2/3/5), EQUITY (classe 1), tiers OTHER (classe 4)
  // scindés par signe du solde (débiteur -> créance/actif, créditeur
  // -> dette/passif) — même principe que la trésorerie (classe 5,
  // débiteur -> disponibilités, créditeur -> concours bancaires),
  // jamais de classe comptable inventée. Limite assumée et documentée
  // (README) : aucune écriture de clôture/affectation du résultat
  // n'existe dans le projet — le résultat de l'exercice n'est donc pas
  // automatiquement intégré aux capitaux propres ; l'écart éventuel
  // entre actif et passif correspond exactement au résultat non affecté.
  // =====================================================================

  async getBalanceSheet(companyId: string, query: DateRangeReportQueryDto) {
    const { endDate } = await this.resolveDateRange(companyId, query.periodId, query.startDate, query.endDate);

    const rows: Array<{ category: string; class_code: string; code: string; label: string; balance: string }> = await this.prisma.$queryRaw`
      SELECT ac.category::text as category, ac.code as class_code, a.code, a.label,
        COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 WHEN l.side = 'DEBIT' THEN l.amount ELSE -l.amount END), 0)::text AS balance
      FROM accounts a
      JOIN account_classes ac ON ac.id = a.account_class_id
      LEFT JOIN accounting_entry_lines l ON l.account_id = a.id AND l.company_id = a.company_id
      LEFT JOIN accounting_entries e ON e.id = l.entry_id AND e.status <> 'DRAFT' AND e.entry_date <= ${endDate}
      WHERE a.company_id = ${companyId}
        AND ac.category IN ('ASSET', 'EQUITY', 'OTHER')
        AND ac.code IN ('1', '2', '3', '4', '5')
      GROUP BY ac.category, ac.code, a.code, a.label
      HAVING COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 WHEN l.side = 'DEBIT' THEN l.amount ELSE -l.amount END), 0) <> 0
      ORDER BY ac.code, a.code
    `;

    const asset: Array<{ code: string; label: string; amount: number; classCode: string }> = [];
    const liability: Array<{ code: string; label: string; amount: number; classCode: string }> = [];
    const equity: Array<{ code: string; label: string; amount: number; classCode: string }> = [];

    for (const r of rows) {
      const balance = Number(r.balance);
      if (r.category === 'EQUITY') {
        // Nature créditrice normale (classe 1) -> solde négatif sous
        // la convention débit-crédit ; affiché en valeur positive au
        // passif. Un solde exceptionnellement débiteur réduit d'autant.
        equity.push({ code: r.code, label: r.label, amount: Math.round(-balance * 100) / 100, classCode: r.class_code });
      } else if (r.class_code === '4' || r.class_code === '5') {
        // Tiers et trésorerie : signe du solde détermine actif/passif —
        // jamais une classification fixe (un compte de tiers peut être
        // tour à tour créance ou dette, un compte de banque peut être à
        // découvert).
        if (balance > 0) asset.push({ code: r.code, label: r.label, amount: Math.round(balance * 100) / 100, classCode: r.class_code });
        else liability.push({ code: r.code, label: r.label, amount: Math.round(-balance * 100) / 100, classCode: r.class_code });
      } else {
        // Classes 2/3 : nature débitrice fixe -> actif.
        asset.push({ code: r.code, label: r.label, amount: Math.round(balance * 100) / 100, classCode: r.class_code });
      }
    }

    const totalAsset = Math.round(asset.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const totalLiability = Math.round(liability.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const totalEquity = Math.round(equity.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const totalPassif = Math.round((totalLiability + totalEquity) * 100) / 100;

    return {
      asOfDate: endDate,
      asset,
      liability,
      equity,
      totals: { totalAsset, totalLiability, totalEquity, totalPassif, gap: Math.round((totalAsset - totalPassif) * 100) / 100 },
    };
  }

  // =====================================================================
  // ANALYSE BUDGÉTAIRE — Étape 15. Réutilise EXACTEMENT
  // BudgetsService.get() (calcul du réalisé depuis les écritures
  // réelles, Étape 14) — aucune deuxième logique de calcul créée ici.
  // =====================================================================

  async getBudgetReport(companyId: string, query: BudgetReportQueryDto) {
    if (query.budgetId) {
      return this.budgetsService.get(companyId, query.budgetId);
    }
    const filters: any = {};
    if (query.periodId) filters.periodId = query.periodId;
    const budgets = await this.budgetsService.list(companyId, filters);
    const details = await Promise.all(budgets.map((b: any) => this.budgetsService.get(companyId, b.id)));
    return { budgets: details };
  }

  // =====================================================================
  // ANALYSE FISCALE — Étape 15. Réutilise EXACTEMENT
  // TaxDeclarationsService.list() (Étape 13) — jamais de recalcul
  // parallèle de la TVA, qui divergerait immanquablement du module
  // Taxes source de vérité.
  // =====================================================================

  async getTaxReport(companyId: string, query: TaxReportQueryDto) {
    const declarations = await this.taxDeclarationsService.list(companyId, { taxId: query.taxId } as any);
    const filtered = declarations.filter((d: any) => {
      if (query.startDate && new Date(d.periodStart) < new Date(query.startDate)) return false;
      if (query.endDate && new Date(d.periodEnd) > new Date(query.endDate)) return false;
      return true;
    });
    const totals = filtered.reduce(
      (acc: any, d: any) => ({
        collected: acc.collected + Number(d.collectedAmount),
        deductible: acc.deductible + Number(d.deductibleAmount),
        net: acc.net + Number(d.netAmount),
        credit: acc.credit + Number(d.creditAmount),
        due: acc.due + Number(d.amountDue),
        paid: acc.paid + Number(d.amountPaid),
      }),
      { collected: 0, deductible: 0, net: 0, credit: 0, due: 0, paid: 0 },
    );
    return {
      declarations: filtered,
      totals: { ...totals, remaining: Math.round((totals.due - totals.paid) * 100) / 100 },
    };
  }

  // =====================================================================
  // ANALYSE DE TRÉSORERIE — Étape 15. Réutilise CashService.list()/
  // BankService.list() (Étape 11) pour l'inventaire des comptes ;
  // agrège directement les tables cash_transactions/bank_transactions
  // (aucune méthode existante n'agrège déjà les mouvements période sur
  // l'ensemble des comptes — requête nouvelle mais du même style que
  // le reste de ce service, pas une deuxième logique de trésorerie).
  // =====================================================================

  async getTreasuryReport(companyId: string, query: DateRangeReportQueryDto) {
    const { startDate, endDate } = await this.resolveDateRange(companyId, query.periodId, query.startDate, query.endDate);

    const [cashAccounts, bankAccounts] = await Promise.all([this.cashService.list(companyId), this.bankService.list(companyId)]);

    const cashRows: Array<{ receipts: string; disbursements: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'RECEIPT' THEN amount ELSE 0 END), 0)::text AS receipts,
        COALESCE(SUM(CASE WHEN type = 'DISBURSEMENT' THEN amount ELSE 0 END), 0)::text AS disbursements
      FROM cash_transactions
      WHERE company_id = ${companyId} AND transaction_date BETWEEN ${startDate} AND ${endDate}
    `;
    const bankRows: Array<{ credits: string; debits: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0)::text AS credits,
        COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0)::text AS debits
      FROM bank_transactions
      WHERE company_id = ${companyId} AND transaction_date BETWEEN ${startDate} AND ${endDate}
    `;

    const cashBalances = await Promise.all(cashAccounts.map((c: any) => this.cashService.getBalance(companyId, c.id)));
    const bankBalances = await Promise.all(bankAccounts.map((b: any) => this.bankService.getBalance(companyId, b.id)));
    const solde = (bal: { balance: number; side: 'DEBIT' | 'CREDIT' }) => (bal.side === 'DEBIT' ? bal.balance : -bal.balance);

    const totalCashBalance = Math.round(cashBalances.reduce((s, b) => s + solde(b), 0) * 100) / 100;
    const totalBankBalance = Math.round(bankBalances.reduce((s, b) => s + solde(b), 0) * 100) / 100;

    return {
      period: { startDate, endDate },
      cash: { accountsCount: cashAccounts.length, receipts: Number(cashRows[0].receipts), disbursements: Number(cashRows[0].disbursements), balance: totalCashBalance },
      bank: { accountsCount: bankAccounts.length, receipts: Number(bankRows[0].credits), disbursements: Number(bankRows[0].debits), balance: totalBankBalance },
      totals: {
        totalReceipts: Math.round((Number(cashRows[0].receipts) + Number(bankRows[0].credits)) * 100) / 100,
        totalDisbursements: Math.round((Number(cashRows[0].disbursements) + Number(bankRows[0].debits)) * 100) / 100,
        totalBalance: Math.round((totalCashBalance + totalBankBalance) * 100) / 100,
      },
    };
  }

  // =====================================================================
  // EXPORT CSV — nouveaux rapports (même utilitaire toCsv, mêmes règles).
  // =====================================================================

  async exportJournalReportCsv(companyId: string, query: JournalReportQueryDto): Promise<string> {
    const report = await this.getJournalReport(companyId, { ...query, page: 1, pageSize: 100000 });
    const header = ['Date', 'N° écriture', 'Journal', 'Compte', 'Libellé', 'Débit', 'Crédit', 'Statut'];
    const rows: string[][] = [];
    for (const e of report.entries) {
      for (const l of e.lines) {
        rows.push([
          e.entryDate.toISOString().slice(0, 10),
          e.entryNumber,
          e.journal.code,
          `${l.account.code} — ${l.account.label}`,
          l.label ?? e.label,
          l.side === 'DEBIT' ? l.amount.toFixed(2) : '',
          l.side === 'CREDIT' ? l.amount.toFixed(2) : '',
          e.status,
        ]);
      }
    }
    return this.toCsv([header, ...rows]);
  }

  async exportIncomeStatementCsv(companyId: string, query: ComparativeReportQueryDto): Promise<string> {
    const report = await this.getIncomeStatement(companyId, query);
    const header = ['Type', 'Code', 'Libellé', 'Montant'];
    const rows = [
      ...report.revenueLines.map((l) => ['Produit', l.code, l.label, l.amount.toFixed(2)]),
      ...report.expenseLines.map((l) => ['Charge', l.code, l.label, l.amount.toFixed(2)]),
      ['', '', 'Résultat net', report.netResult.toFixed(2)],
    ];
    return this.toCsv([header, ...rows]);
  }

  async exportBalanceSheetCsv(companyId: string, query: DateRangeReportQueryDto): Promise<string> {
    const report = await this.getBalanceSheet(companyId, query);
    const header = ['Section', 'Code', 'Libellé', 'Montant'];
    const rows = [
      ...report.asset.map((l) => ['Actif', l.code, l.label, l.amount.toFixed(2)]),
      ...report.liability.map((l) => ['Passif (dettes)', l.code, l.label, l.amount.toFixed(2)]),
      ...report.equity.map((l) => ['Passif (capitaux propres)', l.code, l.label, l.amount.toFixed(2)]),
    ];
    return this.toCsv([header, ...rows]);
  }

  /**
   * Génération CSV compatible Excel : BOM UTF-8 (reconnaissance
   * automatique des accents par Excel), séparateur `;` (convention
   * française/francophone, évite la confusion avec le séparateur
   * décimal `,`), et échappement RFC 4180 correct — jamais de simple
   * concaténation par virgule (§23 : une valeur contenant `;`, `"` ou
   * un retour à la ligne casserait un CSV construit naïvement).
   */
  private toCsv(rows: string[][]): string {
    const escapeField = (field: string): string => {
      if (/[;"\n\r]/.test(field)) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    const body = rows.map((row) => row.map(escapeField).join(';')).join('\r\n');
    return '\uFEFF' + body; // BOM UTF-8
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private signedBalance(balance: number): { amount: number; side: 'DEBIT' | 'CREDIT' } {
    return balance >= 0 ? { amount: balance, side: 'DEBIT' } : { amount: -balance, side: 'CREDIT' };
  }

  /**
   * Résout la période d'analyse : priorité au periodId explicite, puis
   * aux dates explicites, puis par défaut l'exercice actuellement
   * OPEN de l'entreprise (§7 : "par défaut, utiliser l'entreprise
   * active et l'exercice actif").
   */
  private async resolveDateRange(
    companyId: string,
    periodId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ startDate: Date; endDate: Date }> {
    if (periodId) {
      const period = await this.prisma.accountingPeriod.findUnique({ where: { id: periodId } });
      if (!period || period.companyId !== companyId) {
        throw new ForbiddenException('Exercice introuvable pour cette entreprise.');
      }
      return { startDate: period.startDate, endDate: period.endDate };
    }

    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (!(s <= e)) {
        throw new BadRequestException('La date de début doit être antérieure ou égale à la date de fin.');
      }
      return { startDate: s, endDate: e };
    }

    const openPeriod = await this.prisma.accountingPeriod.findFirst({
      where: { companyId, status: 'OPEN' },
      orderBy: { startDate: 'desc' },
    });
    if (!openPeriod) {
      throw new BadRequestException("Aucun exercice ouvert par défaut — précisez une période ou un exercice explicite.");
    }
    return { startDate: openPeriod.startDate, endDate: openPeriod.endDate };
  }
}
