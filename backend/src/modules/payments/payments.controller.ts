import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @RequirePermissions('PAYMENT.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListPaymentsDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('PAYMENT.READ')
  @Get('treasury-accounts')
  async listTreasuryAccounts(@Param('companyId') companyId: string) {
    return this.service.listTreasuryAccounts(companyId);
  }

  @RequirePermissions('PAYMENT.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('PAYMENT.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('PAYMENT.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePaymentDto, @Req() req: Request) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('PAYMENT.CANCEL')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  async cancel(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.cancel(companyId, id, user.id, extractMetadata(req));
  }
}
