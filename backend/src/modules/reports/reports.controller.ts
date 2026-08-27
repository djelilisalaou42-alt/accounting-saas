import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { JournalReportQueryDto } from './dto/journal-report-query.dto';
import { BudgetReportQueryDto, ComparativeReportQueryDto, DateRangeReportQueryDto, TaxReportQueryDto } from './dto/analysis-report-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

// Convention /companies/:companyId/reports/... déjà établie aux Étapes
// 5-7 : companyId provient TOUJOURS du paramètre d'URL authentifié via
// PermissionsGuard (appartenance + permission revérifiées à chaque
// requête), jamais d'un paramètre de requête ni du corps — un
// éventuel companyId envoyé par erreur dans la query string serait de
// toute façon ignoré, seul celui de l'URL fait autorité.
@Controller('companies/:companyId/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @RequirePermissions('REPORT.READ')
  @Get('accounts/:accountId/ledger')
  async getAccountLedger(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
    @Query() query: GeneralLedgerQueryDto,
  ) {
    return this.service.getAccountLedger(companyId, accountId, query);
  }

  @RequirePermissions('REPORT.READ')
  @Get('trial-balance')
  async getTrialBalance(@Param('companyId') companyId: string, @Query() query: TrialBalanceQueryDto) {
    return this.service.getTrialBalance(companyId, query);
  }

  @RequirePermissions('REPORT.EXPORT')
  @Get('accounts/:accountId/ledger/export')
  async exportAccountLedger(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
    @Query() query: GeneralLedgerQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.service.exportAccountLedgerCsv(companyId, accountId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="grand-livre-${accountId}.csv"`);
    res.send(csv);
  }

  @RequirePermissions('REPORT.EXPORT')
  @Get('trial-balance/export')
  async exportTrialBalance(@Param('companyId') companyId: string, @Query() query: TrialBalanceQueryDto, @Res() res: Response) {
    const csv = await this.service.exportTrialBalanceCsv(companyId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="balance-generale.csv"');
    res.send(csv);
  }

  // =====================================================================
  // ÉTAPE 15 — Rapports avancés (journal, compte de résultat, bilan,
  // analyses budgétaire/fiscale/trésorerie).
  // =====================================================================

  @RequirePermissions('REPORT.READ')
  @Get('journal')
  async getJournalReport(@Param('companyId') companyId: string, @Query() query: JournalReportQueryDto) {
    return this.service.getJournalReport(companyId, query);
  }

  @RequirePermissions('REPORT.EXPORT')
  @Get('journal/export')
  async exportJournalReport(@Param('companyId') companyId: string, @Query() query: JournalReportQueryDto, @Res() res: Response) {
    const csv = await this.service.exportJournalReportCsv(companyId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="journal.csv"');
    res.send(csv);
  }

  @RequirePermissions('REPORT.READ')
  @Get('income-statement')
  async getIncomeStatement(@Param('companyId') companyId: string, @Query() query: ComparativeReportQueryDto) {
    return this.service.getIncomeStatement(companyId, query);
  }

  @RequirePermissions('REPORT.EXPORT')
  @Get('income-statement/export')
  async exportIncomeStatement(@Param('companyId') companyId: string, @Query() query: ComparativeReportQueryDto, @Res() res: Response) {
    const csv = await this.service.exportIncomeStatementCsv(companyId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="compte-de-resultat.csv"');
    res.send(csv);
  }

  @RequirePermissions('REPORT.READ')
  @Get('balance-sheet')
  async getBalanceSheet(@Param('companyId') companyId: string, @Query() query: DateRangeReportQueryDto) {
    return this.service.getBalanceSheet(companyId, query);
  }

  @RequirePermissions('REPORT.EXPORT')
  @Get('balance-sheet/export')
  async exportBalanceSheet(@Param('companyId') companyId: string, @Query() query: DateRangeReportQueryDto, @Res() res: Response) {
    const csv = await this.service.exportBalanceSheetCsv(companyId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bilan.csv"');
    res.send(csv);
  }

  @RequirePermissions('REPORT.READ')
  @Get('budget')
  async getBudgetReport(@Param('companyId') companyId: string, @Query() query: BudgetReportQueryDto) {
    return this.service.getBudgetReport(companyId, query);
  }

  @RequirePermissions('REPORT.READ')
  @Get('taxes')
  async getTaxReport(@Param('companyId') companyId: string, @Query() query: TaxReportQueryDto) {
    return this.service.getTaxReport(companyId, query);
  }

  @RequirePermissions('REPORT.READ')
  @Get('treasury')
  async getTreasuryReport(@Param('companyId') companyId: string, @Query() query: DateRangeReportQueryDto) {
    return this.service.getTreasuryReport(companyId, query);
  }
}
