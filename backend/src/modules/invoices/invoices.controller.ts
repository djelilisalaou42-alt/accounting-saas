import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @RequirePermissions('INVOICE.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListInvoicesDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('INVOICE.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('INVOICE.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('INVOICE.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateInvoiceDto, @Req() req: Request) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('INVOICE.VALIDATE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/issue')
  async issue(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.issue(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('INVOICE.CANCEL')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  async cancel(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.cancel(companyId, id, user.id, extractMetadata(req));
  }
}
