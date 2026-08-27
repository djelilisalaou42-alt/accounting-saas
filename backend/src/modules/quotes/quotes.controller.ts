import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto, UpdateQuoteDto } from './dto/quote.dto';
import { ListQuotesDto } from './dto/list-quotes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/quotes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  @RequirePermissions('QUOTE.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListQuotesDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('QUOTE.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('QUOTE.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateQuoteDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('QUOTE.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateQuoteDto, @Req() req: Request) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('QUOTE.SEND')
  @HttpCode(HttpStatus.OK)
  @Post(':id/send')
  async send(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.send(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('QUOTE.ACCEPT')
  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  async accept(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.accept(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('QUOTE.REJECT')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  async reject(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.reject(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('QUOTE.UPDATE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  async cancel(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.cancel(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('QUOTE.CONVERT')
  @HttpCode(HttpStatus.OK)
  @Post(':id/convert')
  async convert(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.convertToInvoice(companyId, id, user.id, extractMetadata(req));
  }
}
