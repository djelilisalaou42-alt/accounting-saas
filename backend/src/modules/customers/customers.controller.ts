import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @RequirePermissions('CUSTOMER.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListCustomersDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('CUSTOMER.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('CUSTOMER.READ')
  @Get(':id/balance')
  async getBalance(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getBalance(companyId, id);
  }

  @RequirePermissions('CUSTOMER.READ')
  @Get(':id/history')
  async getHistory(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getHistory(companyId, id);
  }

  @RequirePermissions('CUSTOMER.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('CUSTOMER.UPDATE')
  @Patch(':id')
  async update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCustomerDto,
    @Req() req: Request,
  ) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('CUSTOMER.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.disable(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('CUSTOMER.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.enable(companyId, id, user.id, extractMetadata(req));
  }
}
