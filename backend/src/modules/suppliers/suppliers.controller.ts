import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { ListSuppliersDto } from './dto/list-suppliers.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @RequirePermissions('SUPPLIER.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListSuppliersDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('SUPPLIER.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('SUPPLIER.READ')
  @Get(':id/balance')
  async getBalance(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getBalance(companyId, id);
  }

  @RequirePermissions('SUPPLIER.READ')
  @Get(':id/history')
  async getHistory(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getHistory(companyId, id);
  }

  @RequirePermissions('SUPPLIER.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('SUPPLIER.UPDATE')
  @Patch(':id')
  async update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSupplierDto,
    @Req() req: Request,
  ) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('SUPPLIER.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.disable(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('SUPPLIER.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.enable(companyId, id, user.id, extractMetadata(req));
  }
}
