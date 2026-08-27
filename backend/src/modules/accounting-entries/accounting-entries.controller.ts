import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccountingEntriesService } from './accounting-entries.service';
import { CreateAccountingEntryDto } from './dto/create-accounting-entry.dto';
import { UpdateAccountingEntryDto } from './dto/update-accounting-entry.dto';
import { ListAccountingEntriesDto } from './dto/list-accounting-entries.dto';
import { ReverseAccountingEntryDto } from './dto/reverse-accounting-entry.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/accounting-entries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountingEntriesController {
  constructor(private readonly service: AccountingEntriesService) {}

  @RequirePermissions('ENTRY.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() filters: ListAccountingEntriesDto) {
    return this.service.list(companyId, filters);
  }

  @RequirePermissions('ENTRY.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('ENTRY.CREATE')
  @Post()
  async create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccountingEntryDto,
    @Req() req: Request,
  ) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ENTRY.UPDATE')
  @Patch(':id')
  async update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAccountingEntryDto,
    @Req() req: Request,
  ) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ENTRY.DELETE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    await this.service.remove(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('ENTRY.VALIDATE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/validate')
  async validate(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.validate(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('ENTRY.REVERSE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reverse')
  async reverse(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReverseAccountingEntryDto,
    @Req() req: Request,
  ) {
    return this.service.reverse(companyId, id, user.id, dto, extractMetadata(req));
  }
}
