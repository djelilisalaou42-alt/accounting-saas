import { Module } from '@nestjs/common';
import { AssetCategoriesController, FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetsService } from './fixed-assets.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [AssetCategoriesController, FixedAssetsController],
  providers: [FixedAssetsService, PermissionsGuard],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
