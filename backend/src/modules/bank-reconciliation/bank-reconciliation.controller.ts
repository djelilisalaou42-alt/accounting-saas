import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BankReconciliationService } from './bank-reconciliation.service';
import { CreateReconciliationDto, ImportStatementDto, MatchLinesDto } from './dto/reconciliation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  @RequirePermissions('RECONCILIATION.READ')
  @Get('bank-accounts/:bankAccountId/reconciliations')
  async list(@Param('companyId') companyId: string, @Param('bankAccountId') bankAccountId: string) {
    return this.service.list(companyId, bankAccountId);
  }

  @RequirePermissions('RECONCILIATION.READ')
  @Get('reconciliations/:id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('BANK.RECONCILE')
  @Post('bank-accounts/:bankAccountId/reconciliations')
  async create(
    @Param('companyId') companyId: string,
    @Param('bankAccountId') bankAccountId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReconciliationDto,
    @Req() req: Request,
  ) {
    return this.service.create(companyId, bankAccountId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('RECONCILIATION.COMPLETE')
  @HttpCode(HttpStatus.OK)
  @Post('reconciliations/:id/complete')
  async complete(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.complete(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('RECONCILIATION.CANCEL')
  @HttpCode(HttpStatus.OK)
  @Post('reconciliations/:id/cancel')
  async cancel(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.cancel(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('RECONCILIATION.READ')
  @Get('bank-accounts/:bankAccountId/unmatched-statement-lines')
  async unmatchedStatement(@Param('companyId') companyId: string, @Param('bankAccountId') bankAccountId: string) {
    return this.service.listUnmatchedStatementLines(companyId, bankAccountId);
  }

  @RequirePermissions('RECONCILIATION.READ')
  @Get('bank-accounts/:bankAccountId/unmatched-book-movements')
  async unmatchedBook(@Param('companyId') companyId: string, @Param('bankAccountId') bankAccountId: string) {
    return this.service.listUnmatchedBookMovements(companyId, bankAccountId);
  }

  @RequirePermissions('BANK.RECONCILE')
  @Post('reconciliations/:id/matches')
  async matchLines(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MatchLinesDto,
    @Req() req: Request,
  ) {
    return this.service.matchLines(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BANK.RECONCILE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('reconciliations/:id/matches/:matchId')
  async unmatchLines(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.service.unmatchLines(companyId, id, matchId, user.id, extractMetadata(req));
  }

  @RequirePermissions('RECONCILIATION.IMPORT')
  @Post('bank-accounts/:bankAccountId/statement-import')
  async importStatement(
    @Param('companyId') companyId: string,
    @Param('bankAccountId') bankAccountId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportStatementDto,
    @Req() req: Request,
  ) {
    return this.service.importStatement(companyId, bankAccountId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('RECONCILIATION.READ')
  @Get('bank-accounts/:bankAccountId/reconciliation-suggestions')
  async suggestMatches(@Param('companyId') companyId: string, @Param('bankAccountId') bankAccountId: string) {
    return this.service.suggestMatches(companyId, bankAccountId);
  }
}
