import { Module } from '@nestjs/common';
import { CompanyTaxSettingsController, TaxDeclarationsController } from './tax-declarations.controller';
import { TaxDeclarationsService } from './tax-declarations.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [CompanyTaxSettingsController, TaxDeclarationsController],
  providers: [TaxDeclarationsService, PermissionsGuard],
  exports: [TaxDeclarationsService],
})
export class TaxDeclarationsModule {}
