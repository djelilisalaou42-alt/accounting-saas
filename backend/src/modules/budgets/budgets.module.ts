import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, PermissionsGuard],
  exports: [BudgetsService],
})
export class BudgetsModule {}
