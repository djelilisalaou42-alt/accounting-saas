import { Module } from '@nestjs/common';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [ChartOfAccountsController],
  providers: [ChartOfAccountsService, PermissionsGuard],
  exports: [ChartOfAccountsService],
})
export class ChartOfAccountsModule {}
