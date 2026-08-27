import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TaxDeclarationsService } from './tax-declarations.service';
import { UpsertCompanyTaxSettingsDto } from './dto/company-tax-settings.dto';
import { CreateTaxDeclarationDto, ListTaxDeclarationsDto, RecordTaxPaymentDto } from './dto/tax-declaration.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/tax-settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompanyTaxSettingsController {
  constructor(private readonly service: TaxDeclarationsService) {}

  @RequirePermissions('TAX.READ')
  @Get()
  async list(@Param('companyId') companyId: string) {
    return this.service.listSettings(companyId);
  }

  @RequirePermissions('TAX.CREATE')
  @Post()
  async upsert(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertCompanyTaxSettingsDto, @Req() req: Request) {
    return this.service.upsertSettings(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('TAX.UPDATE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.disableSettings(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('TAX.UPDATE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.enableSettings(companyId, id, user.id, extractMetadata(req));
  }
}

@Controller('companies/:companyId/tax-declarations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxDeclarationsController {
  constructor(private readonly service: TaxDeclarationsService) {}

  @RequirePermissions('TAX.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListTaxDeclarationsDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('TAX.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('TAX.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaxDeclarationDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('TAX.UPDATE')
  @Post(':id/recalculate')
  async recalculate(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.recalculate(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('TAX.VALIDATE')
  @Post(':id/validate')
  async validate(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.validate(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('TAX.DECLARE')
  @Post(':id/declare')
  async declare(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.declare(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('TAX.PAY')
  @Post(':id/payments')
  async recordPayment(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: RecordTaxPaymentDto, @Req() req: Request) {
    return this.service.recordPayment(companyId, id, user.id, dto, extractMetadata(req));
  }
}
