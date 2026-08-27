import { Module } from '@nestjs/common';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService, PermissionsGuard],
  exports: [BankReconciliationService],
})
export class BankReconciliationModule {}
