import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccountingPeriodsService } from './accounting-periods.service';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { ReopenAccountingPeriodDto } from './dto/reopen-accounting-period.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/accounting-periods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountingPeriodsController {
  constructor(private readonly service: AccountingPeriodsService) {}

  @RequirePermissions('ACCOUNTING_PERIOD.READ')
  @Get()
  async list(@Param('companyId') companyId: string) {
    return this.service.listPeriods(companyId);
  }

  @RequirePermissions('ACCOUNTING_PERIOD.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getPeriod(companyId, id);
  }

  @RequirePermissions('ACCOUNTING_PERIOD.CREATE')
  @Post()
  async create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccountingPeriodDto,
    @Req() req: Request,
  ) {
    return this.service.createPeriod(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ACCOUNTING_PERIOD.CLOSE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/close')
  async close(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.closePeriod(companyId, id, user.id, extractMetadata(req));
  }

  // Réouverture volontairement plus restrictive : permission dédiée
  // ACCOUNTING_PERIOD.REOPEN (non accordée à ACCOUNTANT, seulement à
  // ADMIN — voir seed_step6_permissions.sql), motif obligatoire (DTO),
  // toujours audité avec le motif conservé.
  @RequirePermissions('ACCOUNTING_PERIOD.REOPEN')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reopen')
  async reopen(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReopenAccountingPeriodDto,
    @Req() req: Request,
  ) {
    return this.service.reopenPeriod(companyId, id, user.id, dto, extractMetadata(req));
  }
}
