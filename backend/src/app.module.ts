import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { AccountingFrameworksModule } from './modules/accounting-frameworks/accounting-frameworks.module';
import { AccountingPeriodsModule } from './modules/accounting-periods/accounting-periods.module';
import { ChartOfAccountsModule } from './modules/chart-of-accounts/chart-of-accounts.module';
import { JournalsModule } from './modules/journals/journals.module';
import { AccountingEntriesModule } from './modules/accounting-entries/accounting-entries.module';
import { ReportsModule } from './modules/reports/reports.module';
import { LetteringModule } from './modules/lettering/lettering.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CashModule } from './modules/cash/cash.module';
import { BankModule } from './modules/bank/bank.module';
import { BankReconciliationModule } from './modules/bank-reconciliation/bank-reconciliation.module';
import { FixedAssetsModule } from './modules/fixed-assets/fixed-assets.module';
import { TaxesModule } from './modules/taxes/taxes.module';
import { TaxDeclarationsModule } from './modules/tax-declarations/tax-declarations.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Module racine.
 *
 * Étape 1-2 : socle applicatif (config, Prisma, throttling anti-bruteforce).
 * Les modules métier (Auth, Users, Companies, Accounting...) seront
 * importés ici au fur et à mesure des étapes suivantes (4, 5, ...).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requêtes / minute / IP par défaut
      },
    ]),
    PrismaModule,
    AuthModule,
    CompaniesModule,
    AccountingFrameworksModule,
    AccountingPeriodsModule,
    ChartOfAccountsModule,
    JournalsModule,
    AccountingEntriesModule,
    ReportsModule,
    LetteringModule,
    CustomersModule,
    SuppliersModule,
    QuotesModule,
    InvoicesModule,
    PaymentsModule,
    // --- Modules métier à venir (Étape 11+) ---
    CashModule,
    BankModule,
    BankReconciliationModule,
    FixedAssetsModule,
    TaxesModule,
    TaxDeclarationsModule,
    BudgetsModule,
    AttachmentsModule,
    AuditLogModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    // Audit pré-production : ThrottlerModule.forRoot() était déjà
    // configuré (100 req/min/IP par défaut) mais jamais appliqué
    // globalement — seuls 3 endpoints d'authentification étaient
    // protégés via @UseGuards(AuthThrottlerGuard) explicite. Tout le
    // reste de l'API (exports CSV, upload de pièces jointes,
    // agrégation du dashboard, etc.) n'avait donc AUCUNE limite de
    // débit. Enregistré ici comme garde globale — les endpoints
    // d'authentification gardent leurs limites plus strictes
    // spécifiques (5/min, 3/min) via leurs propres décorateurs
    // @Throttle, qui restent prioritaires sur le défaut global.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
