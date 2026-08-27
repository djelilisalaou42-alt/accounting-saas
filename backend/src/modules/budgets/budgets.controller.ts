import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto, CreateBudgetLineDto, ListBudgetsDto, UpdateBudgetDto, UpdateBudgetLineDto } from './dto/budget.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/budgets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BudgetsController {
  constructor(private readonly service: BudgetsService) {}

  @RequirePermissions('BUDGET.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListBudgetsDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('BUDGET.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('BUDGET.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBudgetDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BUDGET.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBudgetDto, @Req() req: Request) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BUDGET.VALIDATE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/activate')
  async activate(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.activate(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('BUDGET.VALIDATE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/close')
  async close(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.close(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('BUDGET.CREATE')
  @Post(':id/lines')
  async createLine(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBudgetLineDto, @Req() req: Request) {
    return this.service.createLine(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('BUDGET.UPDATE')
  @Patch(':id/lines/:lineId')
  async updateLine(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBudgetLineDto,
    @Req() req: Request,
  ) {
    return this.service.updateLine(companyId, id, lineId, user.id, dto, extractMetadata(req));
  }
}
