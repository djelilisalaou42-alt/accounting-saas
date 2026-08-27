import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BankService } from './bank.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';
import { CreateBankMovementDto, CreateBankTransferDto } from './dto/bank-movement.dto';
import { ListBankMovementsDto } from './dto/list-bank.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/bank-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BankController {
  constructor(private readonly service: BankService) {}

  @RequirePermissions('BANK.READ')
  @Get()
  async list(@Param('companyId') companyId: string) {
    return this.service.list(companyId);
  }

  @RequirePermissions('BANK.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('BANK.READ')
  @Get(':id/balance')
  async getBalance(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getBalance(companyId, id);
  }

  @RequirePermissions('BANK.MOVEMENT.READ')
  @Get(':id/movements')
  async listMovements(@Param('companyId') companyId: string, @Param('id') id: string, @Query() query: ListBankMovementsDto) {
    return this.service.listMovements(companyId, id, query);
  }

  @RequirePermissions('BANK.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBankAccountDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BANK.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBankAccountDto, @Req() req: Request) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BANK.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.disable(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('BANK.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.enable(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('BANK.MOVEMENT.CREATE')
  @Post(':id/movements')
  async createMovement(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBankMovementDto,
    @Req() req: Request,
  ) {
    return this.service.createMovement(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BANK.MOVEMENT.CREATE')
  @Post(':id/transfer')
  async createTransfer(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBankTransferDto,
    @Req() req: Request,
  ) {
    return this.service.createTransfer(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BANK.MOVEMENT.CREATE')
  @Post(':id/transfer-to-cash')
  async createTransferToCash(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { destinationCashAccountId: string; amount: number; transactionDate: string; label?: string },
    @Req() req: Request,
  ) {
    return this.service.createTransferToCash(companyId, id, body.destinationCashAccountId, body.amount, body.transactionDate, user.id, body.label, extractMetadata(req));
  }
}
