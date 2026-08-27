import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BudgetsModule } from '../budgets/budgets.module';
import { TaxDeclarationsModule } from '../tax-declarations/tax-declarations.module';
import { CashModule } from '../cash/cash.module';
import { BankModule } from '../bank/bank.module';

// Étape 15 : importe les modules métier dont les services sont
// réutilisés tels quels pour les analyses budgétaire/fiscale/trésorerie
// (BudgetsService, TaxDeclarationsService, CashService, BankService) —
// jamais de seconde logique de calcul dupliquée dans ReportsService.
@Module({
  imports: [BudgetsModule, TaxDeclarationsModule, CashModule, BankModule],
  controllers: [ReportsController],
  providers: [ReportsService, PermissionsGuard],
  exports: [ReportsService],
})
export class ReportsModule {}
