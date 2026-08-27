import { Module } from '@nestjs/common';
import { AccountingPeriodsController } from './accounting-periods.controller';
import { AccountingPeriodsService } from './accounting-periods.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [AccountingPeriodsController],
  providers: [AccountingPeriodsService, PermissionsGuard],
  exports: [AccountingPeriodsService],
})
export class AccountingPeriodsModule {}
