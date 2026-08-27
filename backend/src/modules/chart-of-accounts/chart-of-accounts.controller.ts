import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { ImportAccountsDto } from './dto/import-accounts.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

// Routes sous /companies/:companyId/accounts — cohérent avec le
// cloisonnement par entreprise déjà en place pour /companies/:companyId/members
// (Étape 5) et /companies/:companyId/accounting-periods (ci-dessus).
// Le cahier des charges suggérait /accounts à la racine ; adapté ici
// pour respecter la convention multi-tenant déjà établie dans le
// projet (voir README, "adapte les noms si les conventions existantes
// du projet sont différentes").
@Controller('companies/:companyId/accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @RequirePermissions('ACCOUNT.READ')
  @Get()
  async list(@Param('companyId') companyId: string) {
    return this.service.listAccounts(companyId);
  }

  @RequirePermissions('ACCOUNT.READ')
  @Get('tree')
  async tree(@Param('companyId') companyId: string) {
    return this.service.getTree(companyId);
  }

  @RequirePermissions('ACCOUNT.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getAccount(companyId, id);
  }

  @RequirePermissions('ACCOUNT.READ')
  @Get(':id/children')
  async children(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getChildren(companyId, id);
  }

  @RequirePermissions('ACCOUNT.CREATE')
  @Post()
  async create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccountDto,
    @Req() req: Request,
  ) {
    return this.service.createAccount(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ACCOUNT.UPDATE')
  @Patch(':id')
  async update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAccountDto,
    @Req() req: Request,
  ) {
    return this.service.updateAccount(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ACCOUNT.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.disableAccount(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('ACCOUNT.ENABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.enableAccount(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('ACCOUNT.IMPORT')
  @Post('import')
  async import(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportAccountsDto,
    @Req() req: Request,
  ) {
    return this.service.importAccounts(companyId, user.id, dto.csvContent, extractMetadata(req));
  }
}
