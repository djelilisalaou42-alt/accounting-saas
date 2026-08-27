import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { FixedAssetsService } from './fixed-assets.service';
import { CreateAssetCategoryDto, UpdateAssetCategoryDto } from './dto/asset-category.dto';
import { CreateFixedAssetDto, DisposeFixedAssetDto, GenerateDepreciationDto, UpdateFixedAssetDto } from './dto/fixed-asset.dto';
import { ListFixedAssetsDto } from './dto/list-fixed-assets.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/asset-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AssetCategoriesController {
  constructor(private readonly service: FixedAssetsService) {}

  @RequirePermissions('ASSET.READ')
  @Get()
  async list(@Param('companyId') companyId: string) {
    return this.service.listCategories(companyId);
  }

  @RequirePermissions('ASSET.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getCategory(companyId, id);
  }

  @RequirePermissions('ASSET.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAssetCategoryDto, @Req() req: Request) {
    return this.service.createCategory(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ASSET.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAssetCategoryDto, @Req() req: Request) {
    return this.service.updateCategory(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ASSET.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.disableCategory(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('ASSET.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.enableCategory(companyId, id, user.id, extractMetadata(req));
  }
}

@Controller('companies/:companyId/fixed-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  @RequirePermissions('ASSET.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListFixedAssetsDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('ASSET.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('ASSET.READ')
  @Get(':id/depreciation-schedule')
  async getSchedule(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.getSchedule(companyId, id);
  }

  @RequirePermissions('ASSET.CREATE')
  @Post()
  async create(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFixedAssetDto, @Req() req: Request) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ASSET.UPDATE')
  @Patch(':id')
  async update(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateFixedAssetDto, @Req() req: Request) {
    return this.service.update(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ASSET.SERVICE')
  @HttpCode(HttpStatus.OK)
  @Post(':id/put-in-service')
  async putInService(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { serviceDate: string },
    @Req() req: Request,
  ) {
    return this.service.putInService(companyId, id, user.id, body.serviceDate, extractMetadata(req));
  }

  @RequirePermissions('ASSET.DEPRECIATE')
  @Post(':id/depreciation')
  async generateDepreciation(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateDepreciationDto,
    @Req() req: Request,
  ) {
    return this.service.generateDepreciation(companyId, id, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('ASSET.DISPOSAL')
  @Post(':id/disposal')
  async dispose(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DisposeFixedAssetDto,
    @Req() req: Request,
  ) {
    return this.service.dispose(companyId, id, user.id, dto, extractMetadata(req));
  }
}
