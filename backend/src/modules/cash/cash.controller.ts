import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CashService } from './cash.service';
import { CreateCashAccountDto, UpdateCashAccountDto } from './dto/cash-account.dto';
import { CreateCashMovementDto, CreateCashTransferDto } from './dto/cash-movement.dto';
import { ListCashMovementsDto } from './dto/list-cash.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/cash-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CashController {
  constructor(private readonly service: CashService) {}

  @RequirePermissions('CASH.READ')
  @Get()
  async list(@Param('companyId') companyId: string) {
    return this.service.list(companyId);
  }

  @RequirePermissions('CASH.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('CASH.READ')
  @Get(':id/balance')
  async getBalance(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getBalance(companyId, id);
  }

  @RequirePermissions('CASH.MOVEMENT.READ')
  @Get(':id/movements')
  async listMovements(@Param('companyId') companyId: string, @Param('id') id: string, @Query() query: ListCashMovementsDto) {
    return this.service.listMovements(companyId, id, query);
  }

  @RequirePermissions('CASH.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCashAccountDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('CASH.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCashAccountDto, @Req() req: Request) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('CASH.CLOSE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.disable(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('CASH.CLOSE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.enable(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('CASH.MOVEMENT.CREATE')
  @Post(':id/movements')
  async createMovement(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCashMovementDto,
    @Req() req: Request,
  ) {
    return this.service.createMovement(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('CASH.MOVEMENT.CREATE')
  @Post(':id/transfer')
  async createTransfer(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCashTransferDto,
    @Req() req: Request,
  ) {
    return this.service.createTransfer(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('CASH.MOVEMENT.CREATE')
  @Post(':id/transfer-to-bank')
  async createTransferToBank(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { destinationBankAccountId: string; amount: number; transactionDate: string; label?: string },
    @Req() req: Request,
  ) {
    return this.service.createTransferToBank(companyId, id, body.destinationBankAccountId, body.amount, body.transactionDate, user.id, body.label, extractMetadata(req));
  }
}
